// Used only by Jest (babel-jest). Vite builds with its own esbuild pipeline.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
