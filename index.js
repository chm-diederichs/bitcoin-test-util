const Client = require('bitcoin-core')
const assert = require('nanoassert')

const rpcInfo = {
  port: 18447,
  username: 'lnd',
  password: 'password',
  network: 'regtest',
  datadir: './.regtest',
}

// const rpcInfoNode2 = {
//   port: 18447,
//   username: 'lnd',
//   password: 'password',
//   network: 'regtest',
//   datadir: './.regtest',
//   wallet: '2'
// }

module.exports = generateAndCollect

const node = new Client(rpcInfo)
// const node2 = new Client(rpcInfoNode2)

async function generateAndCollect (amount, blocks, splitBy = [1], addressType = 'legacy') {
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
  const coinbaseAmt = coinbaseTxns.reduce((acc, val) => acc + val)

  // generate
  const transferAmounts = splitBy.map(portion => amount * portion)

  const transferAddresses = []

  for (let split of splitBy) {
    const address = await node.getNewAddress('', addressType)
    transferAddresses.push(address)
  }

  // generate rpc inputs to create transaction
  const selectedInputs = selectTxInputs(coinbaseTxns, amount)
  const txOutputs = buildTxOutputs(transferAmounts, amount, transferAddresses)

  // format change output
  const changeAddress = await node.getNewAddress('2', addressType)
  const changeOutput = {}
  changeOutput[changeAddress] = castToValidBTCFloat(selectTxInputs.total - amount)

  // add change output
  txOutputs.push(changeOutput)

  // create, sign and send transaction
  const rawTx = await node.createRawTransaction(selectedInputs, txOutputs)
  const signedTx = await node.signRawTransactionWithWallet(rawTx)
  const txid = await node.sendRawTransaction(signedTx.hex)
  
  // confirm transaction
  await node.generateToAddress(6, genAddress)
  
  node.listUnspent().then(unspent => console.log(unspent.filter(utxo => utxo.txid == txid)))
}

function selectTxInputs (inputPool, amount) {
  // assemble tx inputs
  const selectedInputs = []
  let selectedAmount = 0

  while (selectedAmount < amount) {
    const toTransfer = inputPool.pop()
    
    selectedInputs.push({
      txid: toTransfer.txid,
      vout: toTransfer.vout
    })

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

  for (let utxo of newUnspent) {
    const txInfo = await node.getTransaction(utxo.txid)

    if (txInfo.generated) newCoinbaseTxns.push(utxo)
  }

  return coinbaseTxns.concat(newCoinbaseTxns)
}


// bitcoind transfers can only parse up to 8 decimal places
function castToValidBTCFloat (number) {
  return parseFloat(number.toFixed(8))
}

generateAndCollect(100, 100, 100, process.argv[2])


function toSats (btcStr) {
  var [integer, fraction] = btcStr.split('.')

  return BigInt(integer + fraction.padEnd(8,  '0'))
}

function toSats (btcStr) {
   var decimalPlace = btcStr.indexOf('.')
   if (decimalPlace === -1) {
      decimalPlace = btcStr.length - 1
    }
 
  return BigInt(btcStr.padEnd(decimalPlace + 9, '0').replace('.', ''))
}
