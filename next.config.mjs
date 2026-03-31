import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /starkzap[\\/]dist[\\/]src[\\/]bridge[\\/]solana[\\/]hyperlaneRuntime\.js$/,
        path.resolve("./shims/starkzap-hyperlane-runtime.js")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /starkzap[\\/]dist[\\/]src[\\/]connect[\\/]solanaWeb3Runtime\.js$/,
        path.resolve("./shims/starkzap-solana-runtime.js")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /starkzap[\\/]dist[\\/]src[\\/]confidential[\\/]tongo\.js$/,
        path.resolve("./shims/starkzap-tongo.js")
      ),
      new webpack.NormalModuleReplacementPlugin(
        /starkzap[\\/]dist[\\/]src[\\/]wallet[\\/]cartridge\.js$/,
        path.resolve("./shims/starkzap-cartridge.js")
      )
    );

    return config;
  }
};

export default nextConfig;
