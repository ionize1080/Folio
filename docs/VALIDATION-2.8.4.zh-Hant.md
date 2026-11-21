# Folio 2.8.4 發行驗證

[English](VALIDATION-2.8.4.md) · [简体中文](VALIDATION-2.8.4.zh-Hans.md) · [繁體中文](VALIDATION-2.8.4.zh-Hant.md)

Windows 發行工作流程直接驗收將要發行的 Windows x64 可攜 ZIP，並從同一份取出的程式碼建置原始碼壓縮檔。正式驗證 JSON 記錄程式提交、建置連結與執行檔雜湊值。合併前的測試結果收錄在[候選版 Windows 工作流程](https://github.com/ionize1080/Folio/actions/runs/44871390695)。[Windows 發行工作流程](https://github.com/ionize1080/Folio/actions/workflows/release-284.yml) · [驗證 JSON](https://github.com/ionize1080/Folio/releases/download/v2.8.4/Folio-PDF-Studio-2.8.4-validation.json)

## 段落編輯與速度

| 樣本與操作 | 實測結果 |
| --- | --- |
| 恆隆中期報告，兩處帶標籤的段落 | 兩處編輯底圖準備時間由同機對照的 1.468 秒、2.094 秒降至 0.420 秒、0.939 秒。MuPDF 與 PDFium 比對參考像素一致。 |
| 45 頁繁體中文中期報告，第 23 頁替換兩個字 | 430 個未修改字元的位置與編輯範圍外的像素均一致。其餘 44 頁的文字與算繪一致。 |
| 群暉 DS1621+ 中文規格書，修改段落後重新開啟 | 可搜尋到替換後的文字。旁欄、上標註腳及其餘七頁的算繪一致。 |
| 雙欄 NAACL 論文，在摘要中加入文字 | 重新開啟後依內容串流順序擷取文字，與原文相比只增加了輸入的 `Test.`。 |

表中計時對應準備編輯底圖這個步驟。首次進入編輯模式，以及套用需要補充字形的修改，可能耗時更長。可依使用的電腦與 PDF 判斷這些結果對自身文件的參考價值。[實測與保真比對](https://github.com/ionize1080/Folio/pull/26)

### 一次本機編輯從開啟檔案到儲存的耗時

在 45 頁恆隆中期報告第 23 頁，測試選取 `該等資產` 並輸入 `上述資產`。下表按這一次本機執行的各項操作分別計時。第一項從開啟 PDF 開始，編輯階段在跳到第 23 頁後開始。

| 操作及計時終點 | 耗時 |
| --- | ---: |
| 開啟 PDF，直到首頁文字層出現文字 | 1.11 秒 |
| 在第 23 頁進入編輯模式，直到出現第一個可編輯區域 | 3.20 秒 |
| 點選目標段落，直到輸入欄取得焦點並可輸入 | 78 毫秒 |
| 在選取範圍輸入替換文字 | 4.1 毫秒 |
| 點選完成，直到修改生效且段落編輯器關閉 | 12.85 秒 |
| 點選儲存，直到增量儲存完成 | 3.47 秒 |

前表的底圖準備是另一項獨立計時。以上六階段數據來自本機開發組建，Windows 發行工作流程另有執行記錄。

## 增量儲存與獨立閱讀器

| 閱讀器或方法 | 測試與結果 |
| --- | --- |
| Adobe Reader XI 11.0.10.32，12 份公開 PDF | 每份檔案皆以獨立 Windows 程序開啟並可翻到末頁。首次儲存、二次儲存與重做後的檔案，皆可複製出預期中文。[Reader XI 實測](https://github.com/ionize1080/Folio/actions/runs/44870462512/job/136743594117) |
| Adobe Reader XI，7 份檔案的錯誤 14 對照 | 含交叉參照串流的樣本經 2.8.3 兩次增量儲存均出錯。以 2.8.4 直接儲存兩次，以及從出錯檔案再次儲存所得的兩份副本，皆可開啟、翻到末頁並複製預期文字。[重現與復原](https://github.com/ionize1080/Folio/actions/runs/44871005460/job/136745299657) |
| qpdf、MuPDF、PDFium，7 份僅修改書籤的 PDF | qpdf 檢查通過。MuPDF 比對全部 305 頁的文字、幾何尺寸及 0.32 倍算繪，PDFium 比對 19 個抽樣頁面的 0.5 倍算繪，結果均一致。[比對結果](https://github.com/ionize1080/Folio/pull/26) |

## 驗證下載檔案

1. 從同一發行頁面下載 Windows 可攜 ZIP 或原始碼 ZIP，以及 SHA-256 清單。[2.8.4 附件](https://github.com/ionize1080/Folio/releases/tag/v2.8.4) · [SHA-256 清單](https://github.com/ionize1080/Folio/releases/download/v2.8.4/Folio-PDF-Studio-2.8.4-SHA256.txt)
2. 在下載目錄執行 `Get-FileHash -Algorithm SHA256 .\Folio-PDF-Studio-2.8.4-portable-win-x64.zip`。驗證原始碼時，將檔名改為 `Folio-PDF-Studio-2.8.4-source.zip`。
3. 將輸出與清單中同名檔案的雜湊值比對。該清單也包含驗證 JSON 的雜湊值。

[圖文發行說明](RELEASE-2.8.4.zh-Hant.md) · [歷次驗證](VALIDATION.md)
