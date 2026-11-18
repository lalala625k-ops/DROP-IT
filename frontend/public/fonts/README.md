# 界面字体

## ISOCP_IV50

- 英文、数字及西文标点优先使用本机安装的 `ISOCP_IV50`，CSS 通过 `local("ISOCP_IV50")` 加载，不复制或分发字体文件。
- 保留现有字号和行高，粗体由浏览器基于该字面合成；未安装时使用下列 Lil Grotesk 后备字体。

## Lil Grotesk

- 版本：4.002，作者 Bastien Sozeau / Noir Blanc Rouge。
- Copyright 2023 The LilGrotesk Project Authors (https://github.com/noirblancrouge)。
- 来源：https://noirblancrouge.com ，随附 Regular、Medium、Bold、Black 四个字重。
- 本目录 WOFF2 仅进行容器格式转换，保留全部 924 个字符映射、字形及字体元数据；未做子集裁剪。
- 字重分别为 400、500、700、900；许可为 SIL Open Font License 1.1，全文见 `OFL-LilGrotesk.txt`。

## OPPO Sans

- 界面可使用用户已安装的 OPPO Sans（Regular、Medium、Bold），兼容旧版 `OPPOSans R/M/B` 名称。
- Copyright © 2019–2023 by OPPO. All rights reserved. Manufacturer: Hanyi Fonts。
- 官方来源与使用说明：https://www.coloros.com/article/A00000050/ 。
- 官方允许免费个人及商业使用，同时要求不改编或二次开发、不售卖字体、不提供其他下载渠道、不用于违法用途。
- 因此本项目不复制或提供 OPPO 字体文件，只通过 CSS `local()` 调用用户安装的字体；未安装时使用系统中文字体。

全局使用 `"ISOCP_IV50", "Lil Grotesk", "OPPO Sans", "Microsoft YaHei", sans-serif`。ISOCP_IV50 的 CSS 字符范围限定于西文，中文与中文标点继续使用 OPPO Sans。
