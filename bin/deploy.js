#!/usr/bin/env node

/**
 * 此脚本用于打包页面并指定服务器。注意：此脚本需要在项目根目录下使用
 *
 * 使用方法：node bin/deploy.js -p <服务器 root 密码>
 * Options:
 *   --pro: 默认上传到测试环境，如果添加了 -—pro 则上次到正式环境
 *   -p: 服务器 root 密码，不指定则使用服务器默认密码
 *   -s: 跳过 build 步骤，用于一次 build 成功之后多次上传
 *
 * 例如：node bin/deploy.js -p s1234
 *
 * 测试环境部署到 47.102.98.16 ，正式环境部署到 60.205.159.179
 */

const packageJSON = require("../package.json");
const argv = require("yargs").boolean(["s", "pro"]).argv;
const SSH = require("simple-ssh");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const scpClient = require("scp2");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");

const PROJECT_NAME = packageJSON.name;
const ARCHIVE_NAME = "archive.zip"; // zip 压缩后的文件名
const REMOTE_PATH = `/home/FEDAdmin/www/${PROJECT_NAME}`; // 服务器中静态资源文件目录

const username = argv.u || "FEDAdmin";
// const host = argv.pro ? '60.205.159.179' : '47.102.98.16'
const host = "39.105.192.254";
const password = argv.p; // 服务器密码 SSH 密码

// 生成压缩包
function generateZip() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(
      path.join(__dirname, "..", "dist", ARCHIVE_NAME)
    );
    const archive = archiver("zip", {
      zlib: {
        level: 9
      }
    });

    output.on("close", function() {
      console.log("压缩完成");
      resolve();
    });
    archive.on("error", function(err) {
      reject(err);
    });

    archive.pipe(output);
    archive.directory("dist", false);

    archive.finalize();
  });
}

async function main() {
  let result;

  console.log(`开始发布到 ${host}`);

  console.log("[1/5] 构建代码...");
  if (argv.s) {
    console.log("跳过构建阶段，使用当前已有的版本");
  } else {
    result = await exec(`npm run ${argv.pro ? "build:prod" : "build:prod"}`);
    console.log(result.stdout);
  }

  console.log("[2/5] 打包静态资源，生成 zip 包...");
  await generateZip();

  console.log("[3/5] 清理服务器目标目录");
  await clearTargetDir();

  console.log(`[4/5] 上传 zip 包到服务器:${host} ...`);
  await scp();

  console.log("[5/5] 开始远程解压...");
  await execRemoteOperations();
}

function scp() {
  return new Promise((resolve, reject) => {
    scpClient.scp(
      `dist/${ARCHIVE_NAME}`,
      {
        host,
        username: username,
        password: password,
        path: REMOTE_PATH
      },
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

function clearTargetDir() {
  return new Promise((resolve, reject) => {
    const ssh = new SSH({
      host,
      user: username,
      pass: password
    });

    ssh
      .exec(`mkdir ${REMOTE_PATH}`, {
        out: stdout => console.log(stdout),
        exit: () => {
          resolve();
        }
      })
      .exec(`rm -rf ${REMOTE_PATH}/*`, {
        out: stdout => console.log(stdout),
        exit: () => {
          resolve();
        }
      })
      .on("error", function(err) {
        ssh.end();
        reject(err);
      })
      .start();
  });
}

function execRemoteOperations() {
  return new Promise((resolve, reject) => {
    const ssh = new SSH({
      host,
      user: username,
      pass: password
    });

    ssh
      .exec(`unzip -o -d ${REMOTE_PATH} ${REMOTE_PATH}/${ARCHIVE_NAME}`, {
        out: stdout => console.log(stdout)
      })
      .exec(`rm ${REMOTE_PATH}/${ARCHIVE_NAME}`, {
        out: stdout => console.log(stdout),
        exit: () => {
          resolve();
        }
      })
      .on("error", function(err) {
        ssh.end();
        reject(err);
      })
      .start();
  });
}

main()
  .then(() => console.log("[Finished] 成功部署页面"))
  .catch(err => {
    console.error("部署页面出错：");
    console.error(err);
  });
