// require artifacts
const SimpleGriefingWithFees_FactoryArtifact = require('../../build/SimpleGriefingWithFees_Factory.json')
const SimpleGriefingWithFeesArtifact = require('../../build/SimpleGriefingWithFees.json')
const MockNMRArtifact = require('../../build/MockNMR.json')
const ErasureAgreementsRegistryArtifact = require('../../build/Erasure_Agreements.json')
const ErasurePostsRegistryArtifact = require('../../build/Erasure_Posts.json')

// test helpers
const testFactory = require('../modules/Factory')
const { RATIO_TYPES, TOKEN_TYPES } = require('../helpers/variables')

// variables used in initialize()
const tokenID = TOKEN_TYPES.NMR
const factoryName = 'SimpleGriefingWithFees_Factory'
const instanceType = 'Agreement'
const ratio = ethers.utils.parseEther('2')
const feeRatio = ethers.utils.parseEther('0.2')
const mgmtFee = ethers.utils.parseEther('0.01')
const ratioType = RATIO_TYPES.Dec
const staticMetadata = 'TESTING'

const createTypes = [
'address',
'address',
'address',
'uint8',
'uint256',
'uint8',
'uint256',
'uint256',
'bytes',
]

let SimpleGriefingWithFees

before(async () => {
  SimpleGriefingWithFees = await deployer.deploy(SimpleGriefingWithFeesArtifact)
})

function runFactoryTest() {
  const [ownerWallet, stakerWallet, counterpartyWallet] = accounts
  const owner = ownerWallet.signer.signingKey.address
  const staker = stakerWallet.signer.signingKey.address
  const counterparty = counterpartyWallet.signer.signingKey.address

  describe(factoryName, () => {
    it('setups test', () => {
      const createArgs = [
        owner,
        staker,
        counterparty,
        tokenID,
        ratio,
        ratioType,
        feeRatio,
        mgmtFee,
        Buffer.from(staticMetadata),
      ]

      testFactory(
        deployer,
        'SimpleGriefingWithFees_Factory',
        instanceType,
        createTypes,
        createArgs,
        SimpleGriefingWithFees_FactoryArtifact,
        ErasureAgreementsRegistryArtifact,
        ErasurePostsRegistryArtifact,
        [SimpleGriefingWithFees.contractAddress],
      )
    })
  })
}

runFactoryTest()
