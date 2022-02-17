rm ./build/*
yarn build
cp ./package.json ./build/package.json
cp ./LICENSE.md ./build/LICENSE.md
cd ./build
npm login && npm publish