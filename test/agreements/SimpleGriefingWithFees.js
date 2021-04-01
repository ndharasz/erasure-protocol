const { RATIO_TYPES, TOKEN_TYPES } = require('../helpers/variables')
const { abiEncodeWithSelector } = require('../helpers/utils')

const SimpleGriefingWithFeesArtifact = require('../../build/SimpleGriefingWithFees.json')
const SimpleGriefingWithFeesFactoryArtifact = require('../../build/SimpleGriefingWithFees_Factory.json')
const AgreementsRegistryArtifact = require('../../build/Erasure_Agreements.json')
const MockNMRArtifact = require('../../build/MockNMR.json')

describe('SimpleGriefingWithFees', function() {
  // wallets and addresses
  const [
    operatorWallet,
    counterpartyWallet,
    stakerWallet,
    newOperatorWallet,
  ] = accounts
  const operator = operatorWallet.signer.signingKey.address
  const counterparty = counterpartyWallet.signer.signingKey.address
  const staker = stakerWallet.signer.signingKey.address
  const newOperator = newOperatorWallet.signer.signingKey.address

  // variables used in initialize()
  const tokenID = TOKEN_TYPES.NMR
  const stakerStake = ethers.utils.parseEther('200')
  const punishment = ethers.utils.parseEther('100')
  const ratio = 2
  const ratioE18 = ethers.utils.parseEther(ratio.toString())
  const ratioType = RATIO_TYPES.Dec
  const staticMetadata = 'TESTING'
  let currentStake // to increment as we go

  const createABITypes = [
    'address',
    'address',
    'address',
    'uint8',
    'uint256',
    'uint8',
    'bytes',
  ]

  const initArgs = [
    operator,
    staker,
    counterparty,
    tokenID,
    ratioE18,
    ratioType,
    Buffer.from(staticMetadata),
  ]

  // helper function to deploy TestSimpleGriefingWithFees
  const deployAgreement = async (args = initArgs) => {
    const callData = abiEncodeWithSelector('initialize', createABITypes, args)
    const txn = await this.Factory.from(operator).create(callData)

    const receipt = await this.Factory.verboseWaitForTransaction(txn)

    const eventLogs = utils.parseLogs(receipt, this.Factory, 'InstanceCreated')
    assert.equal(eventLogs.length, 1)

    const [event] = eventLogs
    const agreementAddress = event.instance

    const contract = deployer.wrapDeployedContract(
      SimpleGriefingWithFeesArtifact,
      agreementAddress,
      operatorWallet.secretKey,
    )

    return contract
  }
  const deployDeactivatedAgreement = async () => {
    const agreement = await deployAgreement()
    await agreement.from(operator).renounceOperator()
    return agreement
  }

  before(async () => {
    this.SimpleGriefingWithFees = await deployer.deploy(SimpleGriefingWithFeesArtifact)
    this.Registry = await deployer.deploy(AgreementsRegistryArtifact)
    this.Factory = await deployer.deploy(
      SimpleGriefingWithFeesFactoryArtifact,
      false,
      this.Registry.contractAddress,
      this.SimpleGriefingWithFees.contractAddress,
    )
    await this.Registry.from(deployer.signer).addFactory(
      this.Factory.contractAddress,
      '0x',
    )
    this.DeactivatedGriefing = await deployDeactivatedAgreement()

    // fill the token balances of the counterparty and staker
    // counterparty & staker has 1,000 * 10^18 each
    const startingBalance = '1000'
    await NMR.from(counterparty).mintMockTokens(
      counterparty,
      ethers.utils.parseEther(startingBalance),
    )
    await NMR.from(staker).mintMockTokens(
      staker,
      ethers.utils.parseEther(startingBalance),
    )
  })
})