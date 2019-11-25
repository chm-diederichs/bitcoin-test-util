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
    //  initalise state from blockchain
    await this.updateUnspent()
    await this.updateCoinbase()

    // coinbase utxos shall be sent to genAddress by default
    this.genAddress = await this.newAddress(addressType, 'generate')
    this.regularTxns = this.unspent.filter(filterOutRepeats(this.coinbase))
  }

  // update internal state from blockchain
  async update (addressType = randomType()) {
    await this.updateUnspent()
    await this.updateCoinbase()

    this.regularTxns = this.unspent.filter(filterOutRepeats(this.coinbase))
  }

  //  reset the block chain by invalidating block after genesis block
  async reset (reMine) {
    //  reorg to genesis state
    const blockCount = await this.client.getBlockCount()
    if (blockCount !== 0) await this.reorg(blockCount - 1, 0)

    //  reinitialise internal state
    this.coinbase = []
    this.regularTxns = []
    
    // the height to mine back to after reset may be specified
    if (reMine) {
      const newAddress = await this.newAddress()
      await this.generate(reMine, newAddress)
    }
  }

  // get balance from client
  async getBalance () {
    await this.update()
    return this.client.getBalance()
  }

  // updates the list of unspent transactions
  async updateUnspent () {
    this.unspent = await this.client.listUnspent()
  }

  // generate blocks to a specific address, default is genAddress
  async generate (blocks, address = this.genAddress) {
    await this.client.generateToAddress(blocks, address)
    await this.update()
  }

  // generate a new bitcoin address, type may be specified, otherwise type is chosen randomly
  async newAddress (addressType = randomType(), label = 'newAddress') {
    const addressTypes = [
      'legacy',
      'p2sh-segwit',
      'bech32'
    ]

    if (!addressTypes.includes(addressType)) throw new Error(`Unrecognised address types, available options are ${addressTypes}`)

    const address = this.client.getNewAddress(label, addressType)
    return address
  }

  // simulate a reorg to cancel out a specific transaction
  // and then reinsert an identical tx into the new fork
  async reorgTx (txid, depth, insertionDepth = 0) {
    const originalTx = await this.client.getRawTransaction(txid, 1)

    depth = depth || originalTx.confirmations
    if (depth < originalTx.confirmations) throw new Error('must reorg to below block containing tx')

    // miner won't accept repeat tx unless the original was >11 blocks deep
    if (originalTx.confirmations < 11) {
      depth += 11 - originalTx.confirmations
      await this.confirm(11 - originalTx.confirmations)
    }

    // reorg to the specified insertion depth before submitting the transaction
    await this.reorg(depth, depth - insertionDepth)
    await this.update()

    // at this point the transaction should not be visible to the wallet
    if (this.unspent.find(utxo => utxo.txid === txid) === undefined) throw new Error('unspent should not contain tx')

    // resend the same transaction data and continue mining to the original height
    await this.client.sendRawTransaction(originalTx.hex)
    await this.confirm(insertionDepth)

    // finally confirm tx
    await this.confirm()
    await this.update()
  }

  // wrapper around the client functions to send a raw transaction,
  // inputs must be correctly formatted - see rpcFormat
  async send (inputs, outputs, replaceable = true, locktime = null) {
    assert(typeof replaceable === 'boolean', 'replaceable flag must be a boolean')

    const rawTx = await this.client.createRawTransaction(inputs, outputs, locktime, replaceable)
    const signedTx = await this.client.signRawTransactionWithWallet(rawTx)
    const txid = await this.client.sendRawTransaction(signedTx.hex)

    return txid
  }

  // wrapper around native send function - no control over input selection
  async simplerSend (amount, address) {
    const txid = await this.client.sendToAddress(address, amount)
    return txid
  }

  // specify and amount and a list of addresses to send to, fund distribution
  // may be specified, otherwise funds are equally distributed by default
  async simpleSend (amount, addresses, distribution, confirm = true) {
    const balance = await this.getBalance()
    if (amount > balance)  throw new Error('insufficient funds.')

    // if distribution is unspecified, equally distribute funds to addresses
    distribution = distribution || []
    const leftoverAddresses = addresses.slice(distribution.length)

    // if fewer distributed amounts than addresses are specified,
    // remaining funds are equally distributed among the remaining addresses
    if (leftoverAddresses.length > 0) {
      const allocatedAmount = distribution.reduce((acc, val) => acc + val, 0)
      const toLeftover = (amount - allocatedAmount) / leftoverAddresses.length
      const remainingAmounts = leftoverAddresses.map(address => toLeftover)
      distribution = distribution.concat(remainingAmounts)
    }

    if (distribution.reduce((acc, val) => acc + val, 0) > amount) throw new Error ('amounts to transfer exceed amount available')

    //  select inputs for the transaction
    const inputs = selectTxInputs(this.unspent, amount)

    // create outputs
    const outputs = addresses.map(mapToOutput)
    // generate a change address and format input data for rpc
    const changeAddress = await this.newAddress()
    const rpcInput = rpcFormat(inputs, outputs, changeAddress)

    // send and confirm (unless instructed not to) transaction
    const txid = await this.send(...rpcInput)
    if (confirm) await this.confirm()

    return txid

    // map addresses and amounts to formatted outputs
    function mapToOutput (address, index) {
      const output = {}

      output[address] = castToValidBTCFloat(distribution[index])
      return output
    }
  }

  async regularSend (amount, addresses, amounts) {
    if (!this.regularTxns.length) throw new Error ('simple send uses regular txns, run node.collect() first')

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

  async confirm (blocks = 6) {
    await this.generate(blocks)
  }

  // TOFO: build and send tx

  async sendAndConfirm (inputs, outputs, locktime = null) {
    const txid = await this.send(inputs, outputs, false, locktime)

    await this.generate(6)
    return txid
  }

  // fetch tx info for all mempool transactions
  async mempool () {
    const mempool = await this.client.getRawMempool()

    const mempoolTxns = await pMap (mempool, async txid => {
      return this.client.getRawTransaction(txid, 1)
    }, { concurrncy: 5 })

    return mempoolTxns
  }

  // update coinbaseTxns and return available coinbase funds
  async updateCoinbase (initialArray) {
    // if coinbase txns present, copy them into an array
    const currentCoinbase = (this.coinbase) ? this.coinbase.slice() : []

    // fetch new utxos
    await this.updateUnspent()

    const newCoinbaseTxns = []

    // filter already stored coinbase txns from unspent list
    const newUnspent = this.unspent.length === 0
      ? []
      : this.unspent.filter(filterOutRepeats(currentCoinbase))

    // filter out non-coinbase transactions
    await pMap(newUnspent, async utxo => {
      const txInfo = await this.client.getTransaction(utxo.txid)
 
      // utxo.generated flag is set to true for coinbase outputs
      if (txInfo.generated) newCoinbaseTxns.push(utxo)
    }, { concurrency: 5 })

    // update coinbase transactions and recalculate coinbase amount
    this.coinbase = currentCoinbase.concat(newCoinbaseTxns)
    this.coinbaseAmt = this.coinbase.reduce((acc, coinbase) => acc + coinbase.amount, 0)

    return this.coinbase
  }

  // collect coinbase outputs and place funds into regular utxos
  // desired amount can be specified, otherwise the total available
  // coinbase amount shall be used. The distribution of funds may
  // also be defined, default is to collect into a single UTXO
  async collect (amount, splitRatio = [1], addressType = randomType(), feeRate = 0.003) {
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
    const fees = this.coinbase.length > 1000 
      ? this.coinbase.length / 1000 * feeRate 
      : 0.003

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

  // simulate a blockchain reorganisation to depth blocks below the current
  // block and remine up height blocks from that point, default is to mine
  // back up to the current height.
  async reorg (depth, height) {
    if (depth === 0) return
    if (!depth) throw new Error('reorg depth must be specified')
    if (!height && height !== 0) height = depth + 1

    const currentHeight = await this.client.getBlockCount()
    const targetHash = await this.client.getBlockHash(currentHeight - depth)
    
    await this.client.command('invalidateblock', targetHash)

    const address = await this.newAddress()
    if (height > 0) await this.generate(height, address)
  }
  
  // replace an existing mempool transaction using the replace-by-fee -
  // a transaction may be replaced by another transaction with at least
  // one overlapping input, so long as the replacement transaction
  // pays higher absolute fees and a higher fee rate.
  async replaceByFee (inputs = [], outputs = []) {
    const self = this

    const mempool = await this.client.getRawMempool()
    const replaceTxns = []

    // gather mempool transactions being replaced
    await pMap(mempool, async (txid) => {
      const tx = await this.client.getRawTransaction(txid, 1)

      // fileter for mempool for transactions with repeated inputs
      const repeatedInputs = tx.vin.filter(filterForRepeats(inputs))

      // tx info doesn't show the value of inputs, these data
      // must be fetched from the parent tx for each input
      if (repeatedInputs.length > 0) {
        const inputData = await collectInputData(repeatedInputs)
        tx.fees = feeCalculator(inputData, tx.vout)
        replaceTxns.push(tx)
      }
    }, { concurrency:  5 })

    // throw an error if no transactions are being replaced
    if (!replaceTxns.length) throw new Error('No transactions are being replaced, use send methods instead')

    // calculate fee data from the original transaction
    const originalFees = replaceTxns.reduce((acc, tx) => acc + tx.fees, 0) 
    const originalVirtualSize = replaceTxns.reduce((acc, tx) => acc + tx.weight, 0) / 4
    const originalFeeRate = originalFees / originalVirtualSize

    const changeAddress = await this.newAddress()

    // in case fees are not set, calculate minimum fees required
    const fees = await calculateRbfFee()

    // construct actual rbfInput using
    const rbfInput = rpcFormat(inputs, outputs, changeAddress, fees) 
    return this.send(...rbfInput)

    // replace-by-fee helpers:
    // promise resolves with input data for an array of { txid, vout }
    function collectInputData (inputs) {
      return pMap(inputs, async input => {
        const inputTx = await self.client.getRawTransaction(input.txid, 1)
        return inputTx.vout[input.vout]
      }, { concurrency: 5 })
    }

    // determine minimum fees required to replace tx
    async function calculateRbfFee () {
      const weightTestInput = rpcFormat(inputs, outputs, changeAddress, 0.0005)
      const weightTestRaw = await self.client.createRawTransaction(...weightTestInput)
      const weightTestSigned = await self.client.signRawTransactionWithWallet(weightTestRaw)
      const weightTestTx = await self.client.decodeRawTransaction(weightTestSigned.hex)
      
      const virtualSize = weightTestTx.weight / 4
      const minimumFeeByRate = virtualSize * originalFeeRate

      const minimumFees = originalFees > minimumFeeByRate 
        ? originalFees + 0.0000019
        : minimumFeeByRate

      return castToValidBTCFloat(minimumFees)
    }
  }
}

//  helper functions
function matchUtxo (a, b) {
  return a.txid === b.txid && a.vout === b.vout
}

// calculate fee of a transaction
function feeCalculator (inputs, outputs, inputFlag  = 'value', outputFlag = 'value') {
  const inputAmount = inputs.reduce((acc, input) => acc + input[inputFlag], 0)
  const outputAmount = outputs.reduce((acc, output) => acc + output[outputFlag], 0)

  return inputAmount - outputAmount
}

// format rpc inputs to arguments to be passed to the rpc call
// fees may be specified or otherwise default value is used.
// outputs should already be correctly formatted prior
function rpcFormat (inputs, outputs, changeAddress, fees = 0.0004) {
  const changeOutput = {}
  const rpcOutputs = outputs.slice()

  // estimate the fees require fior the given transaction length
  // to ensure minimum fee relay is met for large transactions
  if (inputs.length + outputs.length > 1000) fees *= (inputs.length + outputs.length) / 1000

  const inputTotal = inputs.reduce((acc, input) => acc + input.amount, 0)
  const outputTotal = outputs.reduce((acc, output) => acc + Object.values(output)[0], 0)

  // bitcoin tx fee is the difference between input and output aounts 
  const currentFee = inputTotal - outputTotal

  // if the transaction is paying too high a fee, generate a change address
  if (currentFee > 2 * fees) {
    if (inputTotal < outputTotal) throw new Error('output amount exceeds input amount')
    changeOutput[changeAddress] = castToValidBTCFloat(inputTotal - outputTotal - fees)
    rpcOutputs.push(changeOutput)
  } else {
    if (currentFee < fees) throw new Error('not enough funds to cover fees')
  }

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

// return a random result from available bitcoin address types
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

// filter for repeated utxos -> repeats shall be included in result
function filterForRepeats (txList) {
  return object => {
    return !(!txList.find(target => matchUtxo(target, object)))
  }
}

// filter out repeated utxos -> repeats shall be excluded in result
function filterOutRepeats (txList) {
  return object => {
    return !txList.find(target => matchUtxo(target, object))
  }
}

