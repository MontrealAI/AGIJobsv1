const fs = require('fs');
const path = require('path');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');

module.exports = async function exportAddresses(callback) {
  try {
    const network = process.env.NETWORK || 'development';
    const outputDir = path.join(__dirname, '..', 'artifacts-public', 'addresses');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const addresses = {
      IdentityRegistry: (await IdentityRegistry.deployed()).address,
      StakeManager: (await StakeManager.deployed()).address,
      FeePool: (await FeePool.deployed()).address,
      ValidationModule: (await ValidationModule.deployed()).address,
      DisputeModule: (await DisputeModule.deployed()).address,
      ReputationEngine: (await ReputationEngine.deployed()).address,
      CertificateNFT: (await CertificateNFT.deployed()).address,
      JobRegistry: (await JobRegistry.deployed()).address
    };

    const targetPath = path.join(outputDir, `${network}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(addresses, null, 2));
    console.log('Exported addresses to', targetPath);
    callback();
  } catch (error) {
    callback(error);
  }
};
