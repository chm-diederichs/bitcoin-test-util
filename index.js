const assert = require('nanoassert')
const pMap = require('p-map')

const addressTypes = [
  'bech32',
  'legacy',
  'p2sh-segwit'
]

module.exports = class TestNode {
  constructor (node) {
    this.node = node

    this. genAddress = null

    this.coinbase = []
    this.coinbaseAmt = null

    this.unspent = []
    this.regularBase = []
  }

  async init (addressType = 'legacy') {
    await this.updateUnspent()
    await this.updateCoinbase()

    this.genAddress = await this.node.getNewAddress('generate', addressType)
    this.regularBase = this.unspent.filter(utxo => !this.coinbase.includes(utxo))
  }

  async updateUnspent () {
    this.unspent = await this.node.listUnspent()
  }

  async generate (blocks) {
    await this.node.generateToAddress(blocks, this.genAddress)
  }

  async send (inputs, outputs, replaceable = true, locktime = null) {
    assert(typeof replaceable === 'boolean', 'replaceable flag must be a boolean')

    const rawTx = await this.node.createRawTransaction(inputs, outputs, locktime, replaceable)
    const signedTx = await this.node.signRawTransactionWithWallet(rawTx)
    const txid = await this.node.sendRawTransaction(signedTx.hex)

    return txid
  }

  async confirm () {
    await this.generate(6)
  }

  async sendAndConfirm (inputs, outputs, locktime = null) {
    const txid = await this.send(inputs, outputs, locktime, false)

    await this.generate(6)
    return txid
  }

  // update coinbaseTxns and return available coinbase funds
  async updateCoinbase () {
    const currentCoinbase = this.coinbase || []

    // fetch new utxos
    await this.updateUnspent()

    // filter already stored coinbase txns
    const newCoinbaseTxns = []
    const newUnspent = this.unspent.filter(utxo => !this.coinbase.includes(utxo))

    await pMap(newUnspent, async utxo => {
      const txInfo = await this.node.getTransaction(utxo.txid)
 
      // utxo.generated: true iff utxo is coinbase
      if (txInfo.generated) newCoinbaseTxns.push(utxo)
    }, { concurrency: 5 })

    // update coinbase array and total coinbase amount
    this.coinbase = currentCoinbase.concat(newCoinbaseTxns)
    this.coinbaseAmt = this.coinbase.reduce((acc, coinbase) => acc + coinbase.amount)

    return this.coinbase
  }

  async collect (amount, splitBy = [1], addressType = 'legacy', fees = 0.005) {
    // equal split may be specified by given desired number of UTXOs as an int
    splitBy = typeof splitBy === 'object'
      ? splitBy
      : new Array(splitBy).fill(1 / splitBy)

    // correct for floating point error
    const correction = splitBy.reduce((acc, value) => acc + value) - 1
    splitBy[0] -= correction

    // collect coinbase transactions
    await this.updateCoinbase()
    amount = amount || this.coinbaseAmt

    // generate rpc inputs to create transaction
    const selectedInputs = selectTxInputs(this.coinbase, amount)

    // generate transaction outputs
    const transferAmounts = splitBy.map(portion => amount * portion)

    const txOutputs = await pMap(
      transferAmounts,
      createOutput('random'),
      { concurrency: 5 }
    )

    const changeAddress = await this.node.getNewAddress('change', addressType)
    const rpcInput = rpcFormat(selectedInputs, txOutputs, changeAddress)

    // create, sign and send tx
    const txid = await this.send(...rpcInput)

    return txid

    // map transfer amount to format for rpc input
    function createOutput (addressType) {
      // randomise address type if desired
      const addressFormat = addressType === 'random'
        ? addressTypes[Math.floor(Math.random() * 3)]
        : addressType

      return async (amount) => {
        const address = await node.getNewAddress('', addressFormat)

        const output = {}

        output[address] = castToValidBTCFloat(amount)
        return output
      }
    }
  }

  async reorg (depth, height) {
    assert(depth, 'reorg depth must be specified')
    height = height || depth + 1

    const currentHeight = await node.getblockcount()
    const targetHash = await node.getblockhash(currentHeight - depth)
    
    await node.invalidateBlock(targetHash)
    await node.generateToAddress(height)
  }

  async replaceByFee (inputs = [], outputs = [], flag = 'input') {
    const mempool = this.node.getRawMempool()
    const replaceTxns = []

    // gather mempool transactions being replaced
    await pMap(mempool, async txid => {
      const tx = await this.node.getRawTransaction(txid, 1)
      const repeatedInputs = tx.vin.filter(filterRepeats(inputs))
      const repeatedOutputs = tx.vout.filter(filterRepeats(outputs))
      if (repeatedInputs.length > 0 || repeatedOutputs.length > 0) {
        tx.fees = feeCalculator(tx).absoluteFees
        replaceTxns.push(tx)
      }
    }, { concurrency:  5 })

    const replacedFees = replaceTxns.reduce((acc, tx) => acc + tx.fees, 0)
    const replacedByteLength = replaceTxns.reduce((acc, tx) => acc + tx.hex.length / 2, 0)
    const replaceFeeRate = replacedFees / replacedByteLength

    const changeAddress = replaceTxns[0].vout.pop().addresses[0]

    // in case fees are not set, calculate minimum fees required
    if (!fees) fees = calculateRbfFee()

    // construct actual rbfInput using
    const rbfInput = rpcInput(inputs, outputs, changeAddress, fees) 
    return this.send(...rbfInput)

    // replace-by-fee helpers:
    // filter for repeated utxos
    function filterRepeats (txList) {
      return object => {
        return txList.indexOf(target => matchUtxo(target, object)) !== -1
      }
    }

    // determine minimum fees required to replace tx
    async function calculateRbfFee () {
      const weightTestInput = rpcFormat(rbfInputs, rbfOutputs, changeAddress, 0.0005)
      const weightTestRaw = await this.node.createRawTransaction(...weightTestInput)
      const weightTestTx = await this.node.decodeRawTransaction(weightTestRaw)
      
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

  const absoluteFees = inputAmount - outputAmount

  const byteLength = Buffer.from(tx.hex, 'hex').byteLength
  const feeRate = absoluteFees / byteLength

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
  console.log(outputTotal, inputs, inputTotal, fees)

  changeOutput[changeAddress] = castToValidBTCFloat(inputTotal - outputTotal - fees)
  console.log(changeOutput, 'changeOutput')
  const rpcOutputs = outputs.concat([changeOutput])

  const rpcInputs = inputs.map(input => {
    return {
      txid: input.txid,
      vout: input.vout
    }
  })

  return [
    rpcInputs,
    rpcOutputs
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

// update coinbaseTxns and return available coinbase funds
async function coinbase (coinbaseTxns = []) {
  const unspent = await node.listUnspent()
  console.log(unspent)

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
