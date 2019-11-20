const assert = require('nanoassert')
const pMap = require('p-map')
const request = require('request')
module.exports = class TestNode {
  constructor (node) {
    this.client = node

    this.genAddress = null

    this.coinbase = null
    this.coinbaseAmt = null
    this.genAddress = null

    this.unspent = null
    this.regularTxns = null
  }

  async init (addressType = randomType()) {
    await this.updateUnspent()
    await this.updateCoinbase()

    this.genAddress = await this.newAddress(addressType, 'generate')
    this.regularTxns = this.unspent.filter(filterOutRepeats(this.coinbase))
  }

  async update (addressType = randomType()) {
    await this.updateUnspent()
    await this.updateCoinbase()

    this.regularTxns = this.unspent.filter(filterOutRepeats(this.coinbase))
  }

  async reset (reMine) {
    const blockInfo = await this.client.getBlockCount()

    if (blockInfo.blocks !== 0) await this.reorg(blockInfo - 1, 0)

    this.coinbase = []
    this.regularTxns = []
    
    if (reMine) {
      const newAddress = await this.newAddress()
      await this.generate(reMine, newAddress)
    }
  }

  async getBalance () {
    await this.update()
    return this.client.getBalance()
  }

  async updateUnspent () {
    this.unspent = await this.client.listUnspent()
  }

  async generate (blocks, address = this.genAddress) {
    await this.client.generateToAddress(blocks, address)
    await this.update()
  }

  async newAddress (addressType = randomType(), label = 'newAddress') {
    const addressTypes = [
      'legacy',
      'p2sh-segwit',
      'bech32'
    ]

    assert(addressTypes.includes(addressType), `Unrecognised address types, available options are ${addressTypes}`)

    const address = this.client.getNewAddress(label, addressType)
    return address
  }

  async send (inputs, outputs, replaceable = true, locktime = null) {
    assert(typeof replaceable === 'boolean', 'replaceable flag must be a boolean')

    const rawTx = await this.client.createRawTransaction(inputs, outputs, locktime, replaceable)
    const signedTx = await this.client.signRawTransactionWithWallet(rawTx)
    const txid = await this.client.sendRawTransaction(signedTx.hex)

    return txid
  }

  async simplerSend (amount, address) {
    const txid = await this.client.sendToAddress(address, amount)
    return txid
  }

  async simpleSend (amount, addresses, amounts, confirm = true) {
    const balance = await this.getBalance()
    assert(amount < balance, 'insufficient funds.')

    amounts = amounts || addresses.map(address => castToValidBTCFloat(amount / addresses.length))
    const leftoverAddresses = addresses.slice(amounts.length)

    if (leftoverAddresses.length > 0) {
      const allocatedAmount = amounts.reduce((acc, val) => acc + val, 0)
      const toLeftover = castToValidBTCFloat((amount - allocatedAmount) / leftoverAddresses.length)
      const remainingAmounts = leftoverAddresses.map(address => toLeftover)
      amounts = amounts.concat(remainingAmounts)
    }

    assert(amounts.reduce((acc, val) => acc + val, 0) <= amount, 'Amounts to transfer exceed amount available')
    const inputs = selectTxInputs(this.unspent, amount)

    const outputs = await pMap(
      addresses,
      address => {
        const output = {}
        let toAddress
        let toAmount

        if (typeof address === 'string') {
          toAddress = address
          toAmount = amount / addresses.length
        } else {
          [toAddress, toAmount] = Object.entries(address).pop()
        }

        output[toAddress] = castToValidBTCFloat(toAmount)
        return output
      },
      { concurrency: 5 }
    )

    const changeAddress = await this.newAddress()
    const rpcInput = rpcFormat(inputs, outputs, changeAddress)

    const txid = await this.send(...rpcInput)
    if (confirm) await this.confirm()

    return txid
  }

  async regularSend (amount, addresses, amounts) {
    assert(this.regularTxns.length !== 0, 'simple send uses regular txns, run node.collect() first')

    // amounts = amounts || addresses.map(address => castToValidBTCFloat(amount / addresses.length))
    // assert(amounts.reduce((acc, val) => acc + val, 0) <= amount, 'Amounts to transfer exceed amount available'

    const inputs = selectTxInputs(this.regularTxns, amount)

    const outputs = await pMap(
      addresses,
      address => {
        const output = {}
        output[address] = castToValidBTCFloat(amount / addresses.length)
        return output
      },
      { concurrency: 5 }
    )

    return this.send(inputs, outputs)
  }

  async confirm () {
    await this.generate(6)
  }

  // TOFO: build and send tx

  async sendAndConfirm (inputs, outputs, locktime = null) {
    const txid = await this.send(inputs, outputs, false, locktime)

    await this.generate(6)
    return txid
  }

  // update coinbaseTxns and return available coinbase funds
  async updateCoinbase (initialArray) {
    const currentCoinbase = (this.coinbase) ? this.coinbase.slice() : []

    // fetch new utxos
    // await this.updateUnspent()

    // filter already stored coinbase txns
    const newCoinbaseTxns = []

    const newUnspent = this.unspent.length === 0
      ? []
      : this.unspent.filter(filterOutRepeats(currentCoinbase))

    await pMap(newUnspent, async utxo => {
      const txInfo = await this.client.getTransaction(utxo.txid)
 
      // utxo.generated: true iff utxo is coinbase
      if (txInfo.generated) newCoinbaseTxns.push(utxo)
    }, { concurrency: 5 })

    this.coinbase = currentCoinbase.concat(newCoinbaseTxns)
    this.coinbaseAmt = this.coinbase.reduce((acc, coinbase) => acc + coinbase.amount, 0)

    return this.coinbase
  }

  async collect (amount, splitRatio = [1], addressType = randomType(), fees = 0.0004) {
    const self = this

    // equal split may be specified by given desired number of UTXOs as an int
    splitRatio = typeof splitRatio === 'object'
      ? splitRatio
      : new Array(splitRatio).fill(1 / splitRatio)

    // correct for floating point error
    const correction = splitRatio.reduce((acc, value) => acc + value) - 1
    splitRatio[0] -= correction

    await this.updateCoinbase()

    // collect coinbase transactions
    amount = amount || this.coinbaseAmt - fees

    // generate rpc inputs to create transaction
    const selectedInputs = selectTxInputs(this.coinbase, amount)

    // generate transaction outputs
    const transferAmounts = splitRatio.map(portion => amount * portion)

    const txOutputs = await pMap(
      transferAmounts,
      createOutput(),
      { concurrency: 5 }
    )

    const changeAddress = await this.newAddress(addressType)
    const rpcInput = rpcFormat(selectedInputs, txOutputs, changeAddress, fees)

    // create, sign and send tx
    const txid = await this.send(...rpcInput)
    return txid

    // map transfer amount to format for rpc input
    function createOutput (addressType) {
      // randomise address type if desired
      return async (amount) => {
        const addressFormat = addressType || randomType()
        const address = await self.newAddress(addressFormat)

        const output = {}

        output[address] = castToValidBTCFloat(amount)
        return output
      }
    }
  }

  async reorg (depth, height) {
    assert(depth, 'reorg depth must be specified')
    if (!height && height !== 0) height = depth + 1

    const currentHeight = await this.client.getBlockCount()
    const targetHash = await this.client.getBlockHash(currentHeight - depth)
    
    await this.client.command('invalidateblock', targetHash)

    const address = await this.newAddress()
    if (height > 0) await this.generate(height, address)
  }

  async replaceByFee (inputs = [], outputs = []) {
    const mempool = await this.client.getRawMempool()
    const replaceTxns = []

    // gather mempool transactions being replaced
    await pMap(mempool, async (txid) => {
      const tx = await this.client.getRawTransaction(txid, 1)
      const repeatedInputs = tx.vin.filter(filterForRepeats(inputs))
      const repeatedOutputs = tx.vout.filter(filterForRepeats(outputs))
      if (repeatedInputs.length > 0 || repeatedOutputs.length > 0) {
        tx.fees = feeCalculator(tx).absoluteFee
        replaceTxns.push(tx)
      }
    }, { concurrency:  5 })

    assert(replaceTxns.length, 'No transactions are being replaced, use send methods instead')

    const replacedFees = replaceTxns.reduce((acc, tx) => acc + tx.fees, 0)
    const replacedByteLength = replaceTxns.reduce((acc, tx) => acc + tx.hex.length / 2, 0)
    const replaceFeeRate = replacedFees / replacedByteLength

    const changeAddress = replaceTxns[0].vout.pop().scriptPubKey.addresses[0]

    // in case fees are not set, calculate minimum fees required
    if (!fees) fees = calculateRbfFee()

    // construct actual rbfInput using
    const rbfInput = rpcInput(inputs, outputs, changeAddress, fees) 
    return this.send(...rbfInput)

    // replace-by-fee helpers:

    // determine minimum fees required to replace tx
    async function calculateRbfFee () {
      const weightTestInput = rpcFormat(rbfInputs, rbfOutputs, changeAddress, 0.0005)
      const weightTestRaw = await this.client.createRawTransaction(...weightTestInput)
      const weightTestTx = await this.client.decodeRawTransaction(weightTestRaw)
      
      const weight = weightTestTx.weight
      const minimumFeeByRate = weight * replaceFeeRate

      const minimumFees = replacedFees > minimumFeeByRate ? replacedFees : minimumFeeByRate
      return minimumFees + 0.000001
    }
  }
}

//  helper functions
function matchUtxo (a, b) {
  return a.txid === b.txid && a.vout === b.vout
}

// calculate fee details of a transaction
function feeCalculator (tx) {
  const inputAmount = tx.vin.reduce((acc, input) => acc + input.value, 0)
  const outputAmount = tx.vout.reduce((acc, output) => acc + output.value, 0)

  const absoluteFee = inputAmount - outputAmount

  const byteLength = Buffer.from(tx.hex, 'hex').byteLength
  const feeRate = absoluteFee / byteLength

  return {
    absoluteFee,
    feeRate
  }
}

// format transaction details to arguments to be passed to the rpc call
function rpcFormat (inputs, outputs, changeAddress, fees = 0.0004) {
  const changeOutput = {}

  const inputTotal = inputs.reduce((acc, input) => acc + input.amount, 0)
  const outputTotal = outputs.reduce((acc, output) => acc + Object.values(output)[0], 0)

  if (inputTotal - outputTotal > 2 * fees) {
    assert(inputTotal > outputTotal, 'output amount exceeds input amount')
    changeOutput[changeAddress] = castToValidBTCFloat(inputTotal - outputTotal - fees)
    outputs.push(changeOutput)
  }

  const rpcInputs = inputs.map(input => {
    return {
      txid: input.txid,
      vout: input.vout
    }
  })

  return [
    rpcInputs,
    outputs
  ]
}

// collect tx inputs
function selectTxInputs (inputPool, amount) {
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

function randomType () {
  const addressTypes = [
    'bech32',
    'legacy',
    'p2sh-segwit'
  ]

  const randomIndex = [Math.floor(Math.random() * 3)]

  return addressTypes[randomIndex]
}

// bitcoind transfers can only parse up to 8 decimal places
function castToValidBTCFloat (number) {
  return parseFloat(number.toFixed(8))
}

// filter for/out repeated utxos
function filterForRepeats (txList) {
  return object => {
    return !(!txList.find(target => matchUtxo(target, object)))
  }
}

function filterOutRepeats (txList) {
  return object => {
    return !txList.find(target => matchUtxo(target, object))
  }
}

