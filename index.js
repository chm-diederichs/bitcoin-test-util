const Client = require('bitcoin-core')
const assert = require('nanoassert')
const pMap = require('p-map')

const rpcInfo = {
  port: 18447,
  username: 'lnd',
  password: 'password',
  network: 'regtest',
  datadir: './.regtest',
}

const addressTypes = [
  'bech32',
  'legacy',
  'p2sh-segwit'
]

module.exports = generateAndCollect

const node = new Client(rpcInfo)

generateAndCollect(10, 10, 5)

async function generateAndCollect (amount, blocks, splitBy = [1], addressType = 'legacy', fees = 0.005) {  
  // equal split may be specified by given desired number of UTXOs as an int
  splitBy = typeof splitBy === 'object'
    ? splitBy
    : new Array(splitBy).fill(1 / splitBy)

  // correct for floating point error 
  const correction = splitBy.reduce((acc, value) => acc + value) - 1
  splitBy[0] -= correction

  // check funds don't exceed available amount
  assert(splitBy.reduce((acc, value) => acc + value) <= 1, 'total sum cannot exceed available funds')

  // generate funds
  const genAddress = await node.getNewAddress('1', addressType)
  await node.generateToAddress(blocks, genAddress)
  
  // confirm funds
  await node.generateToAddress(20, genAddress)

  // collect coinbase transactions
  const coinbaseTxns = await coinbase()
  
  // generate rpc inputs to create transaction
  const selectedInputs = selectTxInputs(coinbaseTxns, amount)
  // const txOutputs = buildTxOutputs(transferAmounts, amount, transferAddresses)

  // generate transaction outputs
  const transferAmounts = splitBy.map(portion => amount * portion)

  const txOutputs = await pMap(
    transferAmounts,
    createOutput('random'),
    { concurrency: 5 }
  )

  const changeAddress = await node.getNewAddress('change', addressType)
  const rpcInput = rpcFormat(selectedInputs, txOutputs, changeAddress)

  // create, sign and send tx
  const rawTx = await node.createRawTransaction(...rpcInput, null, true)
  const signedTx = await node.signRawTransactionWithWallet(rawTx)
  const txid = await node.sendRawTransaction(signedTx.hex)

  // create rbf tx using inputs from first tx
  const [rbfInputs, rbfOutputs] = [[], []]

  rbfInputs.push(selectedInputs.slice().sort((a, b) => a.amount - b.amount).pop())
  rbfOutputs.push(txOutputs.slice().sort((a, b) => Object.values(a)[0] - Object.values(b)[0])[0])

  // make rpc input for rbf tx
  const rbfInput = rpcFormat(rbfInputs, rbfOutputs, changeAddress, 0.0005)

  // create, sign and send rbf tx
  const rbfRawTx = await node.createRawTransaction(...rbfInput, null, true)
  const rbfSignedTx = await node.signRawTransactionWithWallet(rbfRawTx)
  const rbfTxid = await node.sendRawTransaction(rbfSignedTx.hex)

  // confirm transaction
  await node.generateToAddress(6, genAddress)

  // list utxos from original tx (should be empty array) and rbf tx
  node.listUnspent().then(unspent => console.log(unspent.filter(utxo => utxo.txid == txid)))
  node.listUnspent().then(unspent => console.log(unspent.filter(utxo => utxo.txid == rbfTxid)))
}

function rpcFormat (inputs, outputs, changeAddress, fees = 0.0004) {
  const changeOutput = {}
 
  const inputTotal = inputs.reduce((acc, input) => acc +  input.amount, 0)
  const outputTotal = outputs.reduce((acc, output) => acc + Object.values(output)[0], 0)
  console.log(outputTotal, inputs, inputTotal, fees)

  changeOutput[changeAddress] = castToValidBTCFloat(inputTotal - outputTotal - fees)
  console.log(changeOutput, 'changeOutput')
  rpcOutputs = outputs.concat([changeOutput])

  const rpcInputs = inputs.map(input => { return {
    txid: input.txid,
    vout: input.vout
  }})

  return [
    rpcInputs,
    rpcOutputs
  ]
}

function createOutput (addressType) {
  addressFormat = addressType === 'random'
    ? addressTypes[Math.floor(Math.random() * 3)]
    : addressType

  return async (amount) => {
    const address = await node.getNewAddress('', addressFormat)

    const output = {}

    output[address] = castToValidBTCFloat(amount)
    return output
  }
}

function selectTxInputs (inputPool, amount) {
  // assemble tx inputs
  const selectedInputs = []
  let selectedAmount = 0

  while (selectedAmount < amount) {
    const toTransfer = inputPool.pop()
    
    selectedInputs.push(toTransfer)

    selectedAmount += toTransfer.amount
  }

  selectTxInputs.total = selectedAmount
  return selectedInputs
}

// build tx outputs
function buildTxOutputs (transferAmounts, totalAmount, addresses) {
  const txOutputs = []

  for (let transferAmount of transferAmounts) {
    const output = {}

    const address = addresses.pop()

    const fees = 0.005 * transferAmount / totalAmount

    output[address] = castToValidBTCFloat(transferAmount - fees)
    txOutputs.push(output)
  }

  return txOutputs
}


// update coinbaseTxns and return available coinbase funds 
async function coinbase (coinbaseTxns = []) {
  const unspent = await node.listUnspent()

  const newUnspent = unspent.filter(utxo => !coinbaseTxns.includes(utxo))

  const newCoinbaseTxns = []

  await pMap(newUnspent, async utxo => {
    const txInfo = await node.getTransaction(utxo.txid)
    if (txInfo.generated) newCoinbaseTxns.push(utxo) 
  }, { concurrency: 5 })

  const returnArray = coinbaseTxns.concat(newCoinbaseTxns)
  coinbase.amount = returnArray.reduce((acc, val) => acc + val)
  return returnArray
}

// bitcoind transfers can only parse up to 8 decimal places
function castToValidBTCFloat (number) {
  return parseFloat(number.toFixed(8))
}
