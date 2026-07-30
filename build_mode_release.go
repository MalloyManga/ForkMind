//go:build !dev

package main

// isDevelopmentBuild 在普通测试和生产构建中为 false
// 生产数据因此跟随最终可执行文件所在的软件目录
const isDevelopmentBuild = false
