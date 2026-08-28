/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Where the build output goes. The default is right everywhere that matters,
   * including on Vercel.
   *
   * The override exists so a build can be verified while `next dev` is running:
   * both write to `.next`, and a build on top of a live dev server corrupts its
   * state and forces a restart. Point this somewhere else and the two coexist.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  webpack: (config) => {
    // pdfjs-dist v4 ships an optional canvas binding meant for Node.
    // The browser build never needs it, so stub it out to keep bundling clean.
    config.resolve.alias.canvas = false;
    return config;
  },
};
export default nextConfig;
