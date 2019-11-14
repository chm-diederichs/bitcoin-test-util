const Client = require('bitcoin-core')
const assert = require('nanoassert')

const rpcInfoNode1 = {
  port: 18447,
  username: 'lnd',
  password: 'password',
  network: 'regtest',
  datadir: './.regtest',
  wallet: '1'
}

const rpcInfoNode2 = {
  port: 18447,
  username: 'lnd',
  password: 'password',
  network: 'regtest',
  datadir: './.regtest',
  wallet: '2'
}

const node1 = new Client(rpcInfoNode1)
const node2 = new Client(rpcInfoNode2)

async function generateAndCollect (blocks, splitBy = [1], addressType = 'legacy') {
  // equal split may be specified by given desired number of UTXOs as an int
  splitBy = typeof splitBy === 'object'
    ? splitBy
    : new Array(splitBy).fill(1 / splitBy)

  // correct for floating point error 
  const correction = splitBy.reduce((acc, value) => acc + value) - 1
  splitBy[0] -= correction

  // check funds don't exceed available amount
  assert(splitBy.reduce((acc, value) => acc + value) <= 1, 'total sum cannot exceed available funds')

  // addresses to generate and collect
  const genAddress = await node1.getNewAddress('1', addressType)
  const collectAddress = await node2.getNewAddress('2', addressType)

  // generate funds
  await node1.generateToAddress(blocks, genAddress)
  
  // confirm funds
  await node1.generateToAddress(20, genAddress)
  
  const availableFunds = await node1.getBalance()

  // store txids in array
  const collectionTxns = []

  // split available funds by specified proportions
  for (let portion of splitBy) {
    const transferAmount = castToValidBTCFloat(availableFunds * portion)
    const fees = castToValidBTCFloat(0.005 * portion)

    const collectTx = await node1.sendToAddress(collectAddress, transferAmount - fees)

    collectionTxns.push(collectTx)
  }

  await node1.generateToAddress(6, genAddress)
  
  node2.listUnspent().then(console.log)
}

function castToValidBTCFloat (number) {
  return parseFloat(number.toFixed(8))
}

generateAndCollect(100, 20, process.argv[2])
