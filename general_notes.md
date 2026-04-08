Several issues identified on the live site while logged in to my Anis profile on supabase.

## General
- Add an extra flag color (purple) - position should be to the right of blue. Update the keyboard shortcut numbering. Purple should be 2 now. 
- Unflag stock by repeating shortcut SHIFT + F. So shift+f followed by a number assigns a flag, then shift + f unflaggs the selected stock(s)
- Main sections in header wrap when page width is too narrow - need a more elegant solution
## AI Insights section
- Explain how lookback period is used by the AI model in the insights prompts
- Insight use of database vs web is not working correctly. I attempted to create a prompt only using web and it failed. When I used both, it correctly retrieved data from the db but failed to get remaining info from the web.

## Left Panel Table behaviour
- When I add a stock from scan results to a list using the plus button, it sometimes switches to the Lists section. Adding a stock to a list should not affect the current page, scan, or list being shown. There is no redirect to the list that the stock was added to. 
- Scans drop down - hover actions current show the folder the stock is in. There is no space for this. Replace the existing icon and text with a simple folder icon.
- Scan dragging doesn't allow the user to directly position the scan within a folder. You can only drop the scan on the folder name and it gets added to the end of the scans in that folder. I should be able to drag and position the scan specifically within a list. I also need to be able to reorder the within in the folder. Right now it takes several attempts to do that. Also, the colored indicator when dragging should give a visual cue that the position is switching from non folder hierarchy to in-folder (perhaps by indenting right).
- Color code Off 52W highs all red in the tables given that the stock price is always below the 52 week high.
- Allow sorting by flag in tables. Descending order: green, red, yellow, purple, blue

## Lists Section
- I want an Industries list to be created using the industries listed from massive (that are assigned and shown in the right panel profile). The purpose of this list is to review the RS rankings for all the time periods. Therefore, the list should have all industries with individual columns for each Industry Rank (1M, 3M, 6M, 12M) and also the % change columns for the same time periods. When opening the list, the default sort should be descending using the 12M rank.

## Right Panel
- Its very hard to notice whether the annual or quarterly tab is active in the right panel - make active tab highlight more distinct
- Some stocks have missing market cap in the right panel, why? All stocks should have at least the current outstanding shares to calculate current market cap. DELL has no market cap.
- Merge RS and Industry RS rank into one table in the right panel. One row for RS and one below for Industry RS. Remove the 1W RS for stocks completely from the DB. Only use 1M, 3M, 6M, 12M. The table doesn't need a heading, only the row and column labels. Make it compact to minimize space usage.

## Historical database  
- I noticed many stocks have missing or incomplete financial data. I need you to investigate all stock and see where there are gaps and why. I understand recent IPOs may not have much historical data, but all active stocks should have financials up to date to at leasty Q4 2025 (or Q1 2026 if they are released). Examples of stocks with missing data below:
    - AEHR latest annual revenue is 2022 - it should be 2025.
    - NBIS no financials
    - SNDK no financials
- Quarterly Revenue and EPS growth calculations are incorrect. They are calculated sequentially e.g. Q4 2025 vs Q3 2025. It should be year over year so Q4 2025 vs Q4 2024. Check the historical database and if necessary recalculate everything and run a backfill for the maximum history available.
- Add dollar volume to the daily bars table (Price * Volume)
- Calculate Average Dollar Volume (ADV) to the indicator table and backfill. Calculate 1 month and 3 month ADV.

## Reference data
- I dont like massive's industry classification. Its too granular. I prefer if we pull the sector (11) and industry (approx 149 i think) classifications from yfinance and classify our entire universe. This will need to be a one time script to update all 5000 plus stocks. 


## Chart 
- The measuring tool is not displaying correctly when I place it with the second mount click. The measure line appears in a random place on the chart. Also, Remove the $ from the change value. Make the data display 2 rows: first row for change % and Change, second for bars and days.
- Right click should cancel any current in progress/selected drawing tool (e.g. measure tool or trend line). If the user selects the tool, does the first left click to start the drawing, and rather than left click again to place the drawing, the user can right click to cancel it.

## New Scan Filters
- Update the scanner filter input for the % off 52W high to disallow negative values. Lowest value for min is zero (meaning price is at 52w highs). Inputs range defines how much below the high the stock price is e.g. min = 0 max = 1% means filter for stocks that are no more than 1% below their highs.
- Add a filter for New 52W High (tick box). This filters for stocks that closed at a new 52 week high.

## Ninoscript
- Ninscript doesn't appear to be working in New Scans. I tried a basic scan P < 10 and it didn't work.
- We need a thorough review of Ninoscript. Perhaps we need to rebuilt the script from scratch piece by piece and then incorporate it into the new scan functionality.  

## Questions I want you to answer for me
Does the daily data refresh check for new IPOs from massive? Or is it only refreshing our existing universe? We need it to add all new IPOs. 

## New Items
- create an Industries list under Lists. It contains all industries. The default columns should be Industry Rank (1M, 3M, 6M, 12M) and also the % change columns for the same time periods. When opening the list, the default sort should be descending using the 12M rank.
