export class CartridgeWallet {
  static async create() {
    throw new Error(
      "[btc-yield-vault] Cartridge integration is disabled in this frontend build."
    );
  }
}
