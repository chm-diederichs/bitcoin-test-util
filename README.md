# bitcoind-coinbase-test
##Usage
A testing node is instantiated by passsing a bitcoin-core client to the contructor
```js
const Client = require('bitcoin-core')
const Node - require('bitcoind-coinbase-test')

const rpcInfo = {
  port: 18443,
  ...
}

const client = new Client(rpcInfo)
const node = new Node(client)
```

###API
####`node.init(addressType)`
Async method to correctly load initial state.
The address to which mined coins are sent can be of specified type from `['legacy', 'p2sh-segwit', 'bech32']`, default is to randomly choose. 

####`node.updateUnspent()`
Fetches list of UTXO from the bitcoin client

####`node.updateCoinbase()`
Parses unspent array for coinbase transactions

####`node.generate(blocks)`
Generate `blocks` new blocks to genAddress

####`node.send(inputs, outputs, replaceable, locktime)`
Submit a transaction to the mempool by passing as arguments the inputs and outputs for the transaction.
`inputs` should be an array of inputs of the form: `{ txid: <txid>, vout: <vout> }`.
`outputs` should be an array of the form `{ receivingAddress: amount}`, where receiving address is a valid bitcoin address as a string.
`replaceable` flag is set to true by default allowing for replace-by-fee transactions.
`locktime` may be specified, but is set to null by default.

####`node.confirm()`
Confirms any mempool transactions by calling `node.generate(6)`

####`node.sendAndConfirm(inputs, outputs, locktime)`
Combines `node.send()` and `node.confirm()` in one step, transactions are unreplaceable and `locktime` is set to null by default.

####`node.collect(amount, splitRatios, addressType, fees)`
Combines coinbase transactions into standard UTXOs.
`amount` specifies the total value of coinbase transactions to be collected, if unspecified `this.coinbaseAmt` is used, attempting to collect *all* coinbase funds.
`splitRatios` indicates how many separate addresses the funds should be sent to and the relative portion of the funds to be sent to each address. By default, all funds shall be sent to a single address. If and integer `n` is passed as `splitRatios`, the funds shall be split equally into `n` different addresses. An additional output shall send leftover funds to a `changeAddress`.
`addressType` of the receiving addresses may be defined for all outputs when the function is called, otherwise a random type is chosen for each output.
`fees` may be specified, but are otherwise arbitrarily set to `0.0005`.

####`node.reorg(depth, height)`
Implement a reorganisation by invalidating the block `depth` below the current block height. The node shall then mine `height` new blocks from the new block height. Note that for a single node, this is equivalent to discarding any transaction data between blocks `currentBlockHeight - depth` and `currentBlockHeight`.

####`node.replaceByFee(inputs, outputs)`
Constructs a transaction that shall replace a mempool transaction by paying higher fees. Inputs and outputs should be passed as arrays with th esame format as `send` methods and MUST contain at least one input *and/or* output with an existing mempool transaction. The feerate shall be calculated and set to ensure the previous transaction is replaced.

## Bitcoind on Docker
### Tags

- `0.18.1`, `0.18`, `latest` ([0.18/Dockerfile](https://github.com/ruimarinho/docker-bitcoin-core/blob/master/0.18/Dockerfile))
- `0.18.1-alpine`, `0.18-alpine` ([0.18/alpine/Dockerfile](https://github.com/ruimarinho/docker-bitcoin-core/blob/master/0.18/alpine/Dockerfile))

### How to use bitcoind Docker image

This image contains the main binaries from the Bitcoin Core project - `bitcoind`, `bitcoin-cli` and `bitcoin-tx`. It behaves like a binary, so you can pass any arguments to the image and they will be forwarded to the `bitcoind` binary:

```sh
$ docker run -p 18443:18443 -p 18444:18444 --rm ruimarinho/bitcoin-core  \
  -regtest=1 \
  -printtoconsole \
  -rpcallowip=0.0.0.0/0 \
  -rpcbind=0.0.0.0:18443 \
  -rpcauth='test:17d76338dc3ad9a60fe49dd951e4ace6$6a3d9c9b577cef280c27b2e1fd864242034bc06f77fa958721a85d6612eb72de' \
  -txindex
  # Defaults are username: test, password: password
```
To set up custom authorisation, run rpcauth.py with `<user>` and `<password>` as arguments and replace rpcauth with the resulting string:

```sh
$ ./rpcauth.py <username> <password>
```

By default, `bitcoind` will run as user `bitcoin` for security reasons and with its default data dir (`~/.bitcoin`). If you'd like to customize where `bitcoin-core` stores its data, you must use the `BITCOIN_DATA` environment variable. The directory will be automatically created with the correct permissions for the `bitcoin` user and `bitcoin-core` automatically configured to use it.

```sh
❯ docker run --env BITCOIN_DATA=/var/lib/bitcoin-core --rm -it ruimarinho/bitcoin-core \
  -printtoconsole \
  -regtest=1
```

You can also mount a directory in a volume under `/home/bitcoin/.bitcoin` in case you want to access it on the host:

```sh
❯ docker run -v ${PWD}/data:/home/bitcoin/.bitcoin -it --rm ruimarinho/bitcoin-core \
  -printtoconsole \
  -regtest=1
```

You can optionally create a service using `docker-compose`:

```yml
bitcoin-core:
  image: ruimarinho/bitcoin-core
  command:
    -printtoconsole
    -regtest=1
```

### Using RPC to interact with the daemon

There are two communications methods to interact with a running Bitcoin Core daemon.

The first one is using a cookie-based local authentication. It doesn't require any special authentication information as running a process locally under the same user that was used to launch the Bitcoin Core daemon allows it to read the cookie file previously generated by the daemon for clients. The downside of this method is that it requires local machine access.

The second option is making a remote procedure call using a username and password combination. This has the advantage of not requiring local machine access, but in order to keep your credentials safe you should use the newer `rpcauth` authentication mechanism.
