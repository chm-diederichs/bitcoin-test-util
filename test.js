const Test = require('./index.js')
const Client = require('bitcoin-core')
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
  t.deepEqual(node.regularTxns, [], 'regular txns should be empty array')

  t.end()
})

ptest('new address', async t => {
  const node = new Test(client)

  await node.init()

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

ptest('generate blocks and update functions', async t => {
  const node = new Test(client)
  await node.init()

  const currentBlockHeight = await client.getBlockCount()

  t.assert(currentBlockHeight === 0, 'block height should be 0')

  await node.generate(200)
  
  const newBlockHeight = await client.getBlockCount()

  t.equal(newBlockHeight - currentBlockHeight, 200, 'blockheight should be 200')

  const balance = await node.getBalance()
  t.assert(typeof balance === 'number', 'balance should be a number')
  t.assert(balance > 0, 'balance should be greater than 0')

  await node.init()

  t.notDeepEqual(node.unspent, [], 'unspent should not be empty')
  t.notDeepEqual(node.coinbase, [], 'coinbase should not be empty')
  t.deepEqual(node.regularTxns, [], 'regularTxns should be empty')
  t.notEqual(node.coinbaseAmt, 0, 'coinbaseAmt should not be 0')

  t.end()
})

ptest('reorg testing', async t => {
  const node = new Test(client)

  await node.init()
  
  const height = await client.getBlockCount()
  const block170hash = await node.client.getBlockHash(height - 30)

  t.equal(height, 200, '200 blocks should have been mined')

  await node.reorg(39, 20)

  const newHeight = await node.client.getBlockCount()
  const newBlock170hash = await node.client.getBlockHash(height - 30)

  t.equal(newHeight, 180, 'After reorg, block height should be 180')
  t.notEqual(block170hash, newBlock170hash, '170th block hash should have changed')

  await node.reorg(0)
  const noOrgHeight = await node.client.getBlockCount()
  const noOrg170hash = await node.client.getBlockHash(height - 30)

  t.equal(noOrgHeight, newHeight, 'After no-org, block height should still be 180')
  t.equal(noOrg170hash, newBlock170hash, '170th block hash should not have changed after no-org')
  t.end()
})

ptest('reset testing', async t => {
  const node = new Test(client)

  await node.init()
  await node.generate(150)
  
  const height = await node.client.getBlockCount()
  const balance = await node.getBalance()

  t.equal(height, 330, '330 blocks should have been mined')
  t.assert(balance > 0, 'balance should be greater than 0')

  await node.reset()
  
  const resetHeight = await node.client.getBlockCount()
  const resetBalance = await node.getBalance()

  t.equal(resetHeight, 0, 'After reset, block height should be 0')
  t.equal(resetBalance, 0, 'balance should 0 after reorg')

  const address = await node.newAddress()
  await node.generate(106, address)

  const newHeight = await node.client.getBlockCount()
  const newBalance = await node.getBalance()

  t.equal(newHeight, 106, 'After reset, block height should be 200')
  t.equal(newBalance, 300, 'balance should 5000 after regeneration')

  await node.reset(106)

  const reMineHeight = await node.client.getBlockCount()
  const reMineBalance = await node.getBalance()

  t.equal(reMineHeight, 106, 'After reset, block height should be 200')
  t.equal(reMineBalance, 300, 'balance should 5000 after regeneration')
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

ptest('send a transaction using simpleSend', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const sendAddress = await node.newAddress()

  const txid = await node.simpleSend(1, [sendAddress, node.genAddress], [0.2])
  const mempool = await node.client.getRawMempool()
  
  t.assert(!mempool.includes(txid), 'mempool should not contain txid')

  const txInfo = await node.client.getRawTransaction(txid, 1)

  t.equal(txInfo.vout.length, 3, 'tx should have 3 outputs')
  t.equal(txInfo.vout[0].scriptPubKey.addresses[0], sendAddress, 'vout[0] should be sent to sendAddress')
  t.equal(txInfo.vout[1].scriptPubKey.addresses[0], node.genAddress, 'vout[1] should be sent to the node.genAddress')
  t.equal(txInfo.vout[0].value, 0.2, 'tx should send 0.2btc to vout[0]')
  t.equal(txInfo.vout[1].value, 0.8, 'tx should send 0.8btc to vout[1]')

  t.end()
})

ptest('send a transaction and resend after reorg', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const address = await node.newAddress()

  const originalTxid = await node.simpleSend(1, [address, node.genAddress], [0.2])
  const originalTx = await node.client.getRawTransaction(originalTxid, 1)

  await node.reorgTx(originalTxid, null, 10)
  const newTx = await node.client.getRawTransaction(originalTxid, 1)

  t.notDeepEqual(originalTx, newTx, 'both txns should have different confirmations')


  // let mempool = await node.client.getRawMempool()

  // t.assert(!mempool.includes(originalTxid), 'mempool should not contain txid')
  // const originalTx = await node.client.getRawTransaction(originalTxid, 1)

  // await node.confirm(5)

  // const originalTx2 = await node.client.getRawTransaction(originalTxid, 1)
  // console.log(originalTx.confirmations, originalTx2.confirmations)

  // await node.reorg(11)
  // const originalTx3 = await node.client.getRawTransaction(originalTxid, 1)
  // console.log(originalTx3)
  // await node.update()

  // t.assert(node.unspent.find(utxo => utxo.txid === originalTx3.txid) === undefined, 'unspent should not contain tx')

  // mempool = await node.client.getRawMempool()
  // const fail = await node.client.getRawTransaction(originalTxid, 1)

  // t.assert(!mempool.includes(originalTxid), 'tx should be in the mempool')

  // const repeatTxid = await node.client.sendRawTransaction(orignialTxInfo.hex)
  // mempool = await node.client.getRawMempool()

  // t.equal(repeatTxid, originalTxid, 'txid should be the same for identical tx')
  // t.assert(mempool.includes(repeatTxid), 'mempool should contain repeat tx')

  // await node.confirm()

  // const confirmed = await node.client.getRawTransaction(repeatTxid, 1)

  t.end()
})

ptest('get mempool transactions', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const address = await node.newAddress()

  const txid = await node.simpleSend(1, [address, node.genAddress], [0.5], false)
  const mempool = await node.mempool()

  t.assert(!mempool.includes(txid), 'mempool should not contain txid')
  t.end()
})

ptest('collect coinbase transactions into a single transaction', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset(500)
  await node.update()

  const startCoinbase = node.coinbase.length
  const startRegularTxns = node.regularTxns.length

  t.equal(startRegularTxns, 0, 'node should only have coinbase txns at this point')

  const tx = await node.collect()

  let mempool = await node.client.getRawMempool()
  t.assert(mempool.includes(tx), 'mempool should contain txid')

  await node.confirm()
  await node.update()

  mempool = await node.client.getRawMempool()
  t.assert(!mempool.includes(tx), 'tx should be confirmed')

  const finalCoinbase = node.coinbase.length

  t.assert(startCoinbase > finalCoinbase, 'coinbase transactions should have been spent')
  t.equal(finalCoinbase, 6, 'node should have 6 coinbase transactions')
  t.equal(node.regularTxns.length, 1, 'node should only have the 11 collect utxos other than coinbase')

  t.end()
})

ptest('replace a mempool transaction using replace-by-fee', async t => {
  const node = new Test(client)
  await node.init()

  const input = node.unspent.pop()
  const address = await node.newAddress()
  const tx = await node.simpleSend(1, [address], null, false)

  let mempool = await node.client.getRawMempool()
  t.assert(mempool.includes(tx), 'mempool should contain txid')

  const rbfAddress = await node.newAddress()
  const rbfTx = await node.replaceByFee([input])
  const rbfTxInfo = await node.client.getRawTransaction(rbfTx, 1)

  mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(tx), 'mempool should no longer contain original tx')
  t.assert(mempool.includes(rbfTx), 'mempool should contain rbf tx')

  t.end()
})

ptest('reset', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset()

  const blockCount = await node.client.getBlockCount()
  await node.update()
  const balance = await node.getBalance()
  
  t.equal(blockCount, 0, 'block count should be 0 after reset')
  t.equal(balance, 0, 'balance should be 0 after reset')
  t.equal(node.unspent.length, 0, 'node should have no unspent txns')
  
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
