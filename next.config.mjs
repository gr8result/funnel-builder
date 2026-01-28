// next.config.mjs
const nextConfig = {
  reactStrictMode: true,

  // opt into Turbopack explicitly
  turbopack: {},

  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "C:\\hiberfil.sys",
        "C:\\pagefile.sys",
        "C:\\swapfile.sys",
        "C:\\DumpStack.log.tmp",
      ],
    };
    return config;
  },
};

export default nextConfig;