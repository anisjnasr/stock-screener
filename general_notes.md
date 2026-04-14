All of the below issues relate to the live site.

## Completed

- Allow reordering of folders in the scan section (sidebar list and header dropdown follow the same persisted folder order; drag from the folder name).

## Open

- Clicking stock in Market Monitor pop up (after clicking one of the indicators) doesn't do anything. It should load the stock in the Lists section
- No industry ranks or financials showing in right panel. They display fine on the local server.
- Make industry name clickable in right panel (drill down function the same as the sectors/industries section). It opens list constituents
- Script editor - cursor skips to end whenever typing a function
- Many recent IPOs have missing IPO dates
- We currently calculate the % of stocks above 50D and 200D SMA for S&P and Nasdaq. I want to calculate both those metrics for the universe defined for the market monitor (stocks with market cap >= 1 bn). You can then add them as two columns to the market monitor to the right of the 52W highs /lows columns. Label the columns simply as >50D and >200D. These should be precomputed during the daily refresh and only fetched when the page is opened.
- Add average daily dollar value traded for each stock in the right panel under the average volume data point. This data point needs to be included in the daily refresh so its precomputed and only fetched when the panel opens. Average Daily Dollar Volume should be added to the scan filters and also be accessible via SSL
- Scan filter - highlight filter fields that have values to distinguish them from fields with no inputs
- Scan table - When i use arrow keys to scroll down a list, the selected stock ends up being out of view. The list doesn't shift to keep the active stock row visible
- Make sure the industries in scan filters match the new mapping from yfinance
- Add to list button in the scan left panel - it currently shows the lists with small checkboxes, when you select one, it immediately adds the stock to the list and closes that pop up. I want the behaviour to be as follows: when you click a list, the checkbox gets checked and the pop up remains open. The purpose is to allow me to add/remove the stock from multiple lists. Clicking on a list that has a checkmark, removed the checkmark and removes the stock from the list. Hence, if a stock is already in a list, when I click the add to watchlist button, that list should already be checked.
- In the market monitor pop up (when clicking an indicator) - replace the "create list" text with a plus button. Plus button has option to create new list or add to existing list by checking a box next to list name. Also, add the option to select individual stocks in both grouped and ungrouped view. Checkbox method.
