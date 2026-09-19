# Petwave GIF Maker

一個純前端、可放在 GitHub Pages 的「揮手 GIF 產生器」。靈感來自 [benisland petpet generator](https://benisland.neocities.org/petpet/)，但這版改成「上傳圖片 + 揮手手掌 + 文字」的整合 GIF。

## 功能

- 上傳 PNG / JPG / WEBP / GIF
- 預覽區直接拖動圖片、手掌、文字
- 自訂文字、字體大小、粗細、顏色、外框
- 調整 FPS、揮手幅度、輸出尺寸、背景
- 匯出一個已經把「圖片 + 揮手 + 文字」合成好的 GIF
- 所有處理都在瀏覽器內完成，不需要後端
- 不依賴外部 CDN；內建簡化 GIF89a encoder，因此適合 GitHub Pages

## 手掌 GIF 放置位置

預設素材就是：

```text
assets/hand.gif
```

這次提供的手掌檔已放到上面的位置。

若你之後換了自己的 GIF，直接覆蓋：

```text
petwave-gif/
└─ assets/
   └─ hand.gif   ← 把新的 GIF 放這裡
```

也可以完全不改資料夾，直接在網站的「② 揮手素材」重新上傳檔案。

## GitHub Pages 部署

1. 把整個 `petwave-gif` 資料夾內容放進 GitHub repository。
2. 確認 `index.html` 在你要發布的根目錄。
3. 到 GitHub → Settings → Pages。
4. Deploy from a branch，選擇你的 branch 與 `/ (root)`。
5. 儲存後等待 GitHub Pages 建置。

## 檔案結構

```text
petwave-gif/
├─ index.html
├─ style.css
├─ app.js
├─ README.md
└─ assets/
   └─ hand.gif
```

## 備註

這個版本為了 GitHub Pages 易部署，沒有使用需要後端或 npm build 的框架。GIF 編碼器直接放在 `app.js`，因此整包上傳即可用。
