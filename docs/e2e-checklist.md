# Manual end-to-end checklist

Run both servers (`uvicorn` on :8000, `npm run dev` on :5173) against a fresh data directory, then walk
through the steps in a desktop browser. Record the date, browser, and pass/fail for each step.

| #   | Step                                                                                                              | Expected                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Open `/`. Try to create a project with a blank name, then create "Demo review".                                    | Blank name is rejected; "Demo review" appears at the top of the list without a page reload.                        |
| 2   | Open the project.                                                                                                 | Empty state "Upload a screenshot to start".                                                                        |
| 3   | Upload a PNG, a JPEG and a WebP in one go.                                                                        | Three thumbnails; the first is selected and shown in the viewer; URL has `?s=<id>`.                                |
| 4   | Upload a `.txt` file renamed to `.png`, then a file larger than 10 MB.                                            | Error banners: "…not a valid image…" and "…larger than 10 MB". Nothing is added. Banners can be dismissed.         |
| 5   | Click three different spots on the image, saving a comment each time (use Ctrl/Cmd+Enter once, Esc once to cancel a fourth). | Pins 1, 2, 3 appear exactly where clicked; the cancelled draft leaves nothing behind; sidebar badge shows 3.       |
| 6   | Click comment 2 in the panel, then click pin 3 on the image.                                                      | The matching pin / comment is highlighted each time; the comment scrolls into view. Esc clears the selection.      |
| 7   | Edit comment 1's text, then delete comment 2 (confirm), then add a new comment.                                   | Edit shows "edited"; pin 2 disappears; the new pin is numbered **4** (numbers are never reused).                   |
| 8   | Resize the window from ~1440 px to ~1024 px to ~800 px wide, then toggle Fit / 100% and scroll.                   | Every pin stays on the same spot of the image at every width and zoom; at ≤ 900 px the layout stacks vertically.   |
| 9   | Reload the page. Then stop and restart `uvicorn` and reload again.                                                | Same screenshot selected (from `?s=`), same pins, numbers, text and counts.                                        |
| 10  | Stop the backend and click around (select another screenshot, try to save a comment).                             | Readable "Can't reach the server…" errors with Retry; the unsaved comment stays in its editor. Restart and retry works. |
| 11  | Delete one screenshot's file from `backend/storage/screenshots/<project>/` by hand and reload.                    | That screenshot shows "Image file missing" and can still be deleted.                                               |
| 12  | Delete a screenshot (confirm), then go back and delete the project (confirm).                                     | Screenshot and its comments are gone; after the project delete, `backend/storage/screenshots/<project>/` no longer exists and the project is gone from the list. |

## Results

| Date | Browser | Steps passed | Notes |
| ---- | ------- | ------------ | ----- |
|      |         |              |       |
