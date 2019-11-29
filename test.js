const Test = require('./index.js')
const Client = require('bitcoin-core')
const test = require('tape')
const ptape = require('tape-promise').default
const assert = require('nanoassert')
const ptest = ptape(test)
const get = require('simple-get')
const pMap = require('p-map')

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

ptest('init: initiate', async t => {
  const node = new Test(client)
  await node.init()

  t.assert(typeof node.genAddress === 'string', 'genAddress should be loaded')
  t.equal(node.coinbaseAmt, 0, 'coinbaseAmt should be 0')
  t.deepEqual(node.unspent, [], 'unspent should be empty array')
  t.deepEqual(node.coinbase, [], 'coinbase should be empty array')
  t.deepEqual(node.regularTxns, [], 'regular txns should be empty array')

  t.end()
})

ptest('newAddress: new address', async t => {
  const node = new Test(client)

  await node.init()

  const legacyAddress = await node.newAddress(null, 'legacy')
  const p2shAddress = await node.newAddress(null, 'p2sh-segwit')
  const bech32Address = await node.newAddress(null, 'bech32')
  const randomAddress = await node.newAddress()

  t.assert(typeof legacyAddress === 'string', 'legacyAddress should be a string')
  t.assert(typeof p2shAddress === 'string', 'p2shAddress should be a string')
  t.assert(bech32Address.slice(0, 5) === 'bcrt1', 'bech32Address should be a string')
  t.assert(typeof randomAddress === 'string', 'randomAddress should be a string')

  const addresses = await node.newAddress(100)

  const correctlyLoaded = addresses.reduce((acc, address) => acc && (typeof address === 'string'), true)
  const bech32Loaded = addresses.filter(address => address.slice(0, 5) === 'bcrt1')
  const legacyLoaded = addresses.filter(ad => ad.slice(0, 1) === 'm' || ad.slice(0, 1) === 'n')

  const randomlyLoaded = legacyLoaded.length + bech32Loaded.length < 100

  t.assert(correctlyLoaded, 'addresses should be correctly loaded')
  t.assert(randomlyLoaded, 'addresses should be randomly loaded')

  const bech32Addresses = await node.newAddress(10, 'bech32')
  const onlyBech32Loaded = bech32Addresses.filter(address => address.slice(0, 5) === 'bcrt1')

  const legacyAddresses = await node.newAddress(10, 'legacy')
  const onlyLegacyLoaded = legacyAddresses.filter(ad => ad.slice(0, 1) === 'm' || ad.slice(0, 1) === 'n')

  const p2shAddresses = await node.newAddress(10, 'p2sh-segwit')
  const onlyP2shLoaded = p2shAddresses.filter(address => address.slice(0, 1) === '2')

  t.assert(onlyLegacyLoaded.length === 10, 'only legacy addresses should be loaded')
  t.assert(onlyBech32Loaded.length === 10, 'only bech32 addresses should be loaded')
  t.assert(onlyP2shLoaded.length === 10, 'only p2sh-segwit addresses should be loaded')

  t.end()
})

ptest('generate / update: generate blocks and update', async t => {
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

ptest('reorg: reorg testing', async t => {
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

ptest('reset: reset testing', async t => {
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

ptest('send: send a transaction', async t => {
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

ptest('confirm: confirm transaction', async t => {
  const node = new Test(client)
  await node.init()

  let mempool = await node.client.getRawMempool()
  t.assert(mempool.length === 1, 'mempool should contain a single tx')

  await node.confirm()

  mempool = await node.client.getRawMempool()
  t.assert(mempool.length === 0, 'tx should be confirmed and mempool should be empty')

  t.end()
})

ptest('sendAndConfirm: send & confirm a transaction', async t => {
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

ptest('simpleSend: send a transaction', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const sendAddress = await node.newAddress()

  const tx = await node.simpleSend(1, [sendAddress, node.genAddress], [0.2])
  const mempool = await node.client.getRawMempool()
  
  t.assert(!mempool.includes(tx.txid), 'mempool should not contain txid')

  const txInfo = await node.client.getRawTransaction(tx.txid, 1)

  t.equal(txInfo.vout.length, 3, 'tx should have 3 outputs')
  t.equal(txInfo.vout[0].scriptPubKey.addresses[0], sendAddress, 'vout[0] should be sent to sendAddress')
  t.equal(txInfo.vout[1].scriptPubKey.addresses[0], node.genAddress, 'vout[1] should be sent to the node.genAddress')
  t.equal(txInfo.vout[0].value, 0.2, 'tx should send 0.2btc to vout[0]')
  t.equal(txInfo.vout[1].value, 0.8, 'tx should send 0.8btc to vout[1]')

  t.end()
})

ptest('reorgTx: send a transaction and resend after reorg', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const address = await node.newAddress()

  const originalTxid = await node.simpleSend(1, [address, node.genAddress], [0.2])
  const originalTx = await node.client.getRawTransaction(originalTxid.txid, 1)

  await node.reorgTx(originalTxid.txid, null, 10)
  const newTx = await node.client.getRawTransaction(originalTxid.txid, 1)

  t.notDeepEqual(originalTx, newTx, 'both txns should have different confirmations')
  t.end()
})

ptest('mempool: get mempool transactions', async t => {
  const node = new Test(client)
  await node.init()
  await node.reset(200)

  const address = await node.newAddress()

  const tx = await node.simpleSend(1, [address, node.genAddress], [0.5], false)
  const mempool = await node.mempool()

  t.assert(!mempool.includes(tx.txid), 'mempool should not contain txid')
  t.end()
})

ptest('collect: gather coinbase transactions into a single transaction', async t => {
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

ptest('replaceByFee: replace a single transaction', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset(200)
  await node.update()

  const input = node.unspent.pop()
  const address = await node.newAddress()
  const tx = await node.simpleSend(1, [address], null, false)

  let mempool = await node.client.getRawMempool()
  t.assert(mempool.includes(tx.txid), 'mempool should contain txid')

  const rbfAddress = await node.newAddress()
  const rbfTx = await node.replaceByFee([input])

  mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(tx.txid), 'mempool should no longer contain original tx')
  t.assert(mempool.includes(rbfTx.txid), 'mempool should contain rbf tx')
  t.end()
})

ptest('replaceByFee: replace small tx with large tx', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset(200)
  await node.update()

  const input = node.unspent.pop()
  const addresses = await node.newAddress(10)

  const tx = await node.simpleSend(1, addresses, null, false, null, 0.000009)
  mempool = await node.client.getRawMempool()

  t.assert(mempool.includes(tx.txid), 'mempool should contain txid')

  const lengthRatio = 8
  const outputs = []

  for (let vout of tx.outputs) {
    const amount = Object.values(vout).pop()

    for (let i = 0; i < lengthRatio; i++) {
      output = {}
      const address = await node.newAddress()

      output[address] = amount / lengthRatio
      outputs.push(output)
    }
  }

  const rbfTx = await node.replaceByFee(tx.inputs, outputs)
  mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(tx.txid), 'mempool should no longer contain original tx')
  t.assert(mempool.includes(rbfTx.txid), 'mempool should contain rbf tx')

  t.end()
})

ptest('replaceByFee: replace large tx with small tx', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset(200)
  await node.update()

  const addresses = await node.newAddress(80)

  const tx = await node.simpleSend(1, addresses, null, false, 0.0000005)
  mempool = await node.client.getRawMempool()

  t.assert(mempool.includes(tx.txid), 'mempool should contain txid')

  const rbfTx = await node.replaceByFee(tx.inputs.slice(0, 1), [])
  mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(tx.txid), 'mempool should no longer contain original tx')
  t.assert(mempool.includes(rbfTx.txid), 'mempool should contain rbf tx')

  t.end()
})

ptest('replaceByFee: replace multiple tx with small tx', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset(200)
  await node.update()

  const addresses = {}

  addresses.smallTx = await node.newAddress(10)
  addresses.largeTx = await node.newAddress(80)

  const smallTx = await node.simpleSend(1, addresses.smallTx, null, false, null, 0.000009)
  mempool = await node.client.getRawMempool()

  const largeTx = await node.simpleSend(1, addresses.largeTx, null, false, 0.0000005)
  mempool = await node.client.getRawMempool()

  t.assert(mempool.includes(largeTx.txid), 'mempool should contain txid')
  t.assert(mempool.includes(smallTx.txid), 'mempool should contain txid')

  const outputs = []
  const rbfTx = await node.replaceByFee([largeTx.inputs.pop(), smallTx.inputs.pop()], outputs)

  mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(smallTx.txid), 'mempool should no longer contain small tx')
  t.assert(!mempool.includes(largeTx.txid), 'mempool should no longer contain large tx')
  t.assert(mempool.includes(rbfTx.txid), 'mempool should contain rbf tx')

  t.end()
})


ptest('replaceByFee: replace multiple tx with large tx', async t => {
  const node = new Test(client)
  await node.init()

  await node.reset(200)
  await node.update()

  const addresses = {}

  addresses.smallTx = await node.newAddress(10)
  addresses.largeTx = await node.newAddress(80)

  const smallTx = await node.simpleSend(1, addresses.smallTx, null, false, null, 0.000009)
  mempool = await node.client.getRawMempool()

  const largeTx = await node.simpleSend(1, addresses.largeTx, null, false, 0.0000005)
  mempool = await node.client.getRawMempool()

  t.assert(mempool.includes(largeTx.txid), 'mempool should contain small txid')
  t.assert(mempool.includes(smallTx.txid), 'mempool should contain large txid')

  const outputs = addresses.largeTx.map(address => {
    const output = {}
    output[address] = 0.0001
    return output
  })

  const rbfTx = await node.replaceByFee([largeTx.inputs.pop(), smallTx.inputs.pop()], outputs)

  mempool = await node.client.getRawMempool()

  t.assert(!mempool.includes(smallTx.txid), 'mempool should no longer contain small tx')
  t.assert(!mempool.includes(largeTx.txid), 'mempool should no longer contain large tx')
  t.assert(mempool.includes(rbfTx.txid), 'mempool should contain rbf tx')

  t.end()
})

ptest('reset: reset blockchain to genesis state', async t => {
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
