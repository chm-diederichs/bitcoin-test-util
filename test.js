const Test = require('./index.js')
const Client = require('bitcoin-core')
// const Client = require('bitcoind-rpc')
const test = require('tape')
const ptape = require('tape-promise').default
const assert = require('nanoassert')
const ptest = ptape(test)
const get = require('simple-get')

const rpcInfo = {
  port: 18443,
  username: 'test',
  password: 'password',
  network: 'regtest'
}

var config = {
  protocol: 'http',
  user: 'test',
  pass: 'password',
  host: '127.0.0.1',
  port: '18443',
}

const client = new Client(rpcInfo)

ptest('create testing node', async t => {  
  const node = new Test(client)

  t.assert(node, 'client is created')
  t.assert(node.updateUnspent, 'updateUnspent method exists')
  t.assert(node.generate, 'generate method exists')
  t.assert(node.confirm, 'confirm method exists')
  t.assert(node.sendAndConfirm, 'sendAndConfirm method exists')
  t.assert(node.updateCoinbase, 'updateCoinbase method exists')
  t.assert(node.collect, 'collect method exists')
  t.assert(node.reorg, 'reorg method exists')
  t.assert(node.replaceByFee, 'replaceByFee method exists')

  t.deepEqual(node.unspent, null, 'unspent should be null')
  t.deepEqual(node.coinbase, null, 'coinbase should be null')
  t.deepEqual(node.regularTxns, null, 'regularTxns should be null')
  t.equal(node.genAddress, null, 'genAddress should be null')
  t.equal(node.coinbaseAmt, null, 'coinbaseAmt should be null')

  t.end()
})

ptest('reorg testing', async t => {
  const node = new Test(client)

  await node.init()
  await node.generate(200)
  
  const height = (await node.client.getBlockchainInformation()).blocks
  const block170hash = await node.client.getBlockHash(height - 30)

  t.equal(height, 200, '200 blocks should have been mined')

  await node.reorg(39, 20)

  const newHeight = (await node.client.getBlockchainInformation()).blocks
  const newBlock170hash = await node.client.getBlockHash(height - 30)

  t.equal(newHeight, 180, 'After reorg, block height should be 180')
  t.notEqual(block170hash, newBlock170hash, '170th block hash should have changed')
  t.end()
})

ptest('reset testing', async t => {
  const node = new Test(client)

  await node.init()
  await node.generate(150)
  
  const height = (await node.client.getBlockchainInformation()).blocks
  const balance = await node.getBalance()

  t.equal(height, 150, '200 blocks should have been mined')
  t.assert(balance > 0, 'balance should be greater than 0')

  await node.reset()
  
  const resetHeight = (await node.client.getBlockchainInformation()).blocks
  const resetBalance = await node.getBalance()

  t.equal(resetHeight, 0, 'After reset, block height should be 0')
  t.equal(resetBalance, 0, 'balance should 0 after reorg')

  const address = await node.newAddress()
  await node.generate(106, address)

  const newHeight = (await node.client.getBlockchainInformation()).blocks
  const newBalance = await node.getBalance()

  t.equal(newHeight, 106, 'After reset, block height should be 200')
  t.equal(newBalance, 300, 'balance should 5000 after regeneration')

  await node.reset(106)

  const reMineHeight = (await node.client.getBlockchainInformation()).blocks
  const reMineBalance = await node.getBalance()

  t.equal(reMineHeight, 106, 'After reset, block height should be 200')
  t.equal(reMineBalance, 300, 'balance should 5000 after regeneration')
  t.end()
})

ptest('new address', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const legacyAddress = await node.newAddress('legacy')
  const p2shAddress = await node.newAddress('p2sh-segwit')
  const bech32Address = await node.newAddress('bech32')
  const randomAddress = await node.newAddress()

  t.assert(typeof legacyAddress === 'string', 'legacyAddress should be a string')
  t.assert(typeof p2shAddress === 'string', 'p2shAddress should be a string')
  t.assert(typeof bech32Address === 'string', 'bech32Address should be a string')
  t.assert(typeof randomAddress === 'string', 'randomAddress should be a string')

  t.end()
})

ptest('get balance', async t => {
  const node = new Test(client)
  await node.init()

  t.assert(typeof node.genAddress === 'string', 'genAddress should be loaded')
  t.equal(node.coinbaseAmt, 0, 'coinbaseAmt should be 0')
  t.deepEqual(node.unspent, [], 'unspent should be empty array')
  t.deepEqual(node.coinbase, [], 'coinbase should be empty array')
  t.deepEqual(node.regularBase, [], 'genAddress should be empty array')

  t.end()
})

ptest('initiate', async t => {
  const node = new Test(client)
  await node.init()

  t.assert(typeof node.genAddress === 'string', 'genAddress should be loaded')
  t.equal(node.coinbaseAmt, 0, 'coinbaseAmt should be 0')
  t.deepEqual(node.unspent, [], 'unspent should be empty array')
  t.deepEqual(node.coinbase, [], 'coinbase should be empty array')
  t.deepEqual(node.regularBase, [], 'genAddress should be empty array')

  t.end()
})

ptest('generate blocks and update functions', async t => {
  const node = new Test(client)
  await node.init()

  const currentBlockHeight = await client.getBlockCount()

  t.assert(currentBlockHeight === 0, 'block height should be 0')

  await node.generate(106)
  
  const newBlockHeight = await client.getBlockCount()

  t.equal(newBlockHeight - currentBlockHeight, 106, 'blockheight should be 100')

  const balance = await node.getBalance()
  t.assert(typeof balance === 'number', 'balance should be a number')
  t.assert(balance > 0, 'balance should be greater than 0')

  await node.init()

  t.notDeepEqual(node.unspent, [], 'unspent should not be empty')
  t.notDeepEqual(node.coinbase, [], 'coinbase should not be empty')
  t.notDeepEqual(node.regularTxns, [], 'regularTxns should not be empty')
  t.notEqual(node.coinbaseAmt, 0, 'coinbaseAmt should not be 0')

  t.end()
})

ptest('send a transaction', async t => {
  const node = new Test(client)

  await node.init()

  const input = node.coinbase.slice(0, 1)
  
  const output = [{}]
  const outputAmount = input[0].amount * 0.9999
  output[0][node.genAddress] = parseFloat(outputAmount.toFixed(8))

  const txid = await node.send(input, output)

  const mempool = await node.client.getRawMempool()

  t.assert(mempool.includes(txid), 'mempool should contain txid')

  const tx = await node.client.getRawTransaction(txid, 1)
  const txDetails = await node.client.getTransaction(txid, true)

  t.assert(tx.vin.length === 1, 'tx should have a single input')
  t.equal(tx.vin[0].txid, input[0].txid, 'input should be that previously selected')
  t.assert(tx.vout.length === 1, 'tx should have a single output')
  t.equal(txDetails.details[1].address, node.genAddress, 'output should be to genAddress')
  t.equal(txDetails.details[1].amount, outputAmount, 'output should be of specified amount')
  
  t.end()
})

ptest('confirm transaction', async t => {
  const node = new Test(client)
  await node.init()

  let mempool = await node.client.getRawMempool()
  t.assert(mempool.length === 1, 'mempool should contain a single tx')

  await node.confirm()

  mempool = await node.client.getRawMempool()
  t.assert(mempool.length === 0, 'tx should be confirmed and mempool should be empty')

  t.end()
})

ptest('send & confirm a transaction via sendAndConfirm method', async t => {
  const node = new Test(client)
  await node.init()

  const input = node.coinbase.slice(0, 1)
  
  const output = [{}]
  const outputAmount = input[0].amount * 0.9999
  output[0][node.genAddress] = parseFloat(outputAmount.toFixed(8))

  const txid = await node.sendAndConfirm(input, output)

  const mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(txid), 'mempool should not contain txid')

  const tx = await node.client.getRawTransaction(txid, 1)
  const txDetails = await node.client.getTransaction(txid, true)

  t.assert(tx.vin.length === 1, 'tx should have a single input')
  t.equal(tx.vin[0].txid, input[0].txid, 'input should be that previously selected')
  t.assert(tx.vout.length === 1, 'tx should have a single output')
  t.equal(txDetails.details[1].address, node.genAddress, 'output should be to genAddress')
  t.equal(txDetails.details[1].amount, outputAmount, 'output should be of specified amount')

  t.end()
})

ptest('collect coinbase transactions into a single transaction', async t => {
  const node = new Test(client)
  await node.init()

  const address = await node.newAddress()

  const tx = await node.simpleSend(1, [address, node.genAddress], [0.5])
  const mempool = await node.client.getRawMempool()

  t.assert(mempool.includes(tx), 'mempool should not contain txid')
  t.end()
})

ptest('cause a reorganisation', async t => {
  const node = new Test(client)
  await node.init()

  t.end()
})

ptest('replace a mempool transaction using replace-by-fee', async t => {
  const node = new Test(client)
  await node.init()

  t.end()
})

ptest('reset', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset()

  const blockChainInfo = await node.client.getBlockchainInformation()
  const balance = await node.getBalance()
  
  t.equal(blockChainInfo.blocks, 0, 'block count should be 0 after reset')
  t.equal(balance, 0, 'balance should be 0 after reset')
  t.end()
})

function delay (time) {
  assert(typeof time === 'number')
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}
