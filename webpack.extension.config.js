const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    popup: './src/extension/src/popup.ts',
    background: './src/extension/src/background/background.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/extension'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              compilerOptions: {
                noEmitOnError: false
              }
            }
          }
        ],
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { 
          from: 'src/extension/public',
          to: '.'
        },
        {
          from: 'src/extension/icons',
          to: 'icons'
        }
      ]
    })
  ]
}; 