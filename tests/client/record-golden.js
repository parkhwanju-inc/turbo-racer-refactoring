// golden.json 다시 기록:  node tests/client/record-golden.js
// 리팩토링 중에는 돌리지 말 것. 트랙/물리를 일부러 바꿨을 때만, 바뀐 값을 확인한 뒤에.
"use strict";
const fs = require("fs");
const path = require("path");
const { computeGolden } = require("./golden");

const file = path.join(__dirname, "golden.json");
fs.writeFileSync(file, JSON.stringify(computeGolden(), null, 1) + "\n");
console.log("기록함:", file);
