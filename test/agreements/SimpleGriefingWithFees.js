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

  describe('SimpleGriefingWithFees.initialize', () => {
    it('should initialize contract', async () => {
      this.TestSimpleGriefingWithFees = await deployAgreement()

      // check that SimpleGriefingWithFees do not have Countdown contract attributes
      // getLength should not be present in SimpleGriefingWithFees
      assert.strictEqual(this.SimpleGriefingWithFees.getLength, undefined)
      assert.strictEqual(this.SimpleGriefingWithFees.startCountdown, undefined)

      // check that it's the TestSimpleGriefingWithFees state that is changed
      // not the SimpleGriefingWithFees logic contract's state

      // check all the state changes

      // Staking._setToken
      const [token] = await this.TestSimpleGriefingWithFees.getToken()
      assert.equal(token, tokenID)

      // _data.staker
      const getStaker = await this.TestSimpleGriefingWithFees.getStaker()
      assert.equal(getStaker, staker)

      // _data.counterparty
      const getCounterparty = await this.TestSimpleGriefingWithFees.getCounterparty()
      assert.equal(getCounterparty, counterparty)

      // Operator._setOperator
      const operator = await this.TestSimpleGriefingWithFees.getOperator()
      assert.equal(operator, operator)

      // Griefing._setRatio
      const [
        actualRatio,
        actualRatioType,
      ] = await this.TestSimpleGriefingWithFees.getRatio(staker)
      assert.equal(actualRatio.toString(), ratioE18.toString())
      assert.equal(actualRatioType, ratioType)

      assert.equal(await this.TestSimpleGriefingWithFees.isReleased(), false)
      assert.equal(await this.TestSimpleGriefingWithFees.getTotalStakeTokens(), 0)
      assert.equal(await this.TestSimpleGriefingWithFees.getStakeholderValue(staker), 0)
    })

    it('should revert when not initialized from constructor', async () => {
      await assert.revertWith(
        this.TestSimpleGriefingWithFees.initialize(...initArgs),
        'must be called within contract constructor',
      )
    })
  })

  describe('SimpleGriefing.setMetadata', () => {
    const stakerMetadata = 'STAKER'
    const operatorMetadata = 'OPERATOR'

    it('should revert when msg.sender is active operator', async () => {
      // use the counterparty to be the msg.sender
      await assert.revertWith(
        this.TestSimpleGriefingWithFees.from(counterparty).setMetadata(
          Buffer.from(stakerMetadata),
        ),
        'only operator',
      )
    })

    it('should revert when msg.sender is deactivated operator', async () => {
      await assert.revertWith(
        this.DeactivatedGriefing.from(operator).setMetadata(
          Buffer.from(stakerMetadata),
        ),
        'only operator',
      )
    })

    it('should set metadata when msg.sender is operator', async () => {
      const txn = await this.TestSimpleGriefingWithFees.from(operator).setMetadata(
        Buffer.from(operatorMetadata),
      )
      await assert.emitWithArgs(
        txn,
        'MetadataSet',
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(operatorMetadata)),
      )
    })
  })

  describe('SimpleGriefing.increaseStake', () => {
    let amountToAdd = 500 // 500 token weis

    const increaseStake = async sender => {
      await NMR.from(sender).approve(
        this.TestSimpleGriefingWithFees.contractAddress,
        amountToAdd,
      )

      const txn = await this.TestSimpleGriefingWithFees.from(sender).increaseStake(
        amountToAdd,
      )

      currentStake += amountToAdd

      const receipt = await this.TestSimpleGriefingWithFees.verboseWaitForTransaction(
        txn,
      )
      const depositIncreasedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === 'DepositIncreased',
        'There is no such event',
      )
      console.log(amountToAdd)
      assert.isDefined(depositIncreasedEvent)
      assert.equal(depositIncreasedEvent.args.tokenID, tokenID)
      assert.equal(depositIncreasedEvent.args.user, staker)
      assert.equal(depositIncreasedEvent.args.amount.toNumber(), amountToAdd)
      assert.equal(await this.TestSimpleGriefingWithFees.getStakeholderValue(staker), amountToAdd)
    }

    it('should revert when msg.sender is counterparty', async () => {
      // update currentStake
      currentStake = (await this.TestSimpleGriefingWithFees.getStake()).toNumber()

      // use the counterparty to be the msg.sender
      await assert.revertWith(
        this.TestSimpleGriefingWithFees.from(counterparty).increaseStake(amountToAdd),
        'only staker or operator',
      )
    })

    it('should increase when msg.sender is deactivated operator', async () => {
      this.DeactivatedGriefing.from(operator).increaseStake(amountToAdd, {
        gasLimit: 30000,
      })
      await assert.revertWith(
        await this.TestSimpleGriefingWithFees.getStakeholderValue(operator),
        amountToAdd,
      )
    })

    it('should increase stake when msg.sender is staker', async () => {
      await increaseStake(staker)
    })

    it('should increase stake when msg.sender is operator', async () => {
      await increaseStake(operator)
    })
  })

  describe('SimpleGriefing.reward', () => {
    let currentStake // to increment as we go
    let amountToAdd = 500 // 500 token weis

    const reward = async sender => {
      // update currentStake
      currentStake = (await this.TestSimpleGriefing.getStake()).toNumber()

      await NMR.from(sender).approve(
        this.TestSimpleGriefing.contractAddress,
        amountToAdd,
      )

      const txn = await this.TestSimpleGriefing.from(sender).reward(amountToAdd)

      currentStake += amountToAdd

      assert.equal(
        (await this.TestSimpleGriefing.getStake()).toNumber(),
        currentStake,
      )

      const receipt = await this.TestSimpleGriefing.verboseWaitForTransaction(
        txn,
      )
      const depositIncreasedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === 'DepositIncreased',
        'There is no such event',
      )

      assert.isDefined(depositIncreasedEvent)
      assert.equal(depositIncreasedEvent.args.tokenID, tokenID)
      assert.equal(depositIncreasedEvent.args.user, staker)
      assert.equal(depositIncreasedEvent.args.amount.toNumber(), amountToAdd)
    }

    it('should revert when msg.sender is staker', async () => {
      // update currentStake
      currentStake = (await this.TestSimpleGriefing.getStake()).toNumber()

      // use the staker to be the msg.sender
      await assert.revertWith(
        this.TestSimpleGriefing.from(staker).reward(amountToAdd),
        'only counterparty or operator',
      )
    })

    it('should revert when msg.sender is deactivated operator', async () => {
      await assert.revertWith(
        this.DeactivatedGriefing.from(operator).reward(amountToAdd),
        'only counterparty or operator',
      )
    })

    it('should succeed when msg.sender is counterparty', async () => {
      await reward(counterparty)
    })

    it('should succeed when msg.sender is operator', async () => {
      await reward(operator)
    })
  })

})