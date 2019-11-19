const Test = require('./index.js')
const Client = require('bitcoin-core')
const test = require('tape')
const ptape = require('tape-promise').default
const assert = require('nanoassert')
const ptest = ptape(test)

const rpcInfo = {
  port: 18443,
  username: 'test',
  password: 'password',
  network: 'regtest'
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
