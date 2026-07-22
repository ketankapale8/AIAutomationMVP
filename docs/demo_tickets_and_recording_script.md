# End-to-End Demo Guide & Scripts

Use these two tickets to demonstrate the platform's ability to translate product requirements into precise, localized workspace changes that hot-reload live on the UI.

---

## Ticket 1: POS-401 (Story)
*   **Title**: `Add system statistics utility 'sysinfo' to command terminal`
*   **Description**:
    ```text
    Users currently have no quick way to inspect their active session statistics inside the virtual command line interface. We need to introduce a new command utility called 'sysinfo'.
    
    Requirements:
    1. When a user runs 'sysinfo' in the terminal, it should print the system properties in a clean, human-readable format.
    2. The properties displayed must include the OS Name, the active username, and a static agent connection status.
    ```
*   **Acceptance Criteria (AC)**:
    - Running `sysinfo` in the virtual terminal app displays the system statistics block.
    - Typing `help` in the terminal shows the `sysinfo` command in the list of available commands.

---

## Ticket 2: POS-402 (Story)
*   **Title**: `Display a persistent Workspace Banner on the Desktop screen`
*   **Description**:
    ```text
    To make our virtual workspace feel personalized, we want to add a floating branding banner on the main desktop interface. 
    
    Requirements:
    1. The banner should be positioned at the top-center of the desktop wallpaper area.
    2. The banner should display the text "Developer Sandbox Session".
    3. Style the banner with a semi-transparent dark background, rounded corners, white text, and clean padding so it sits elegantly over any wallpaper.
    ```
*   **Acceptance Criteria (AC)**:
    - A banner displaying "Developer Sandbox Session" is persistently visible on the desktop.
    - The banner is centered horizontally at the top of the viewport.
    - The design utilizes rounded corners and semi-transparent styling to remain legible over light and dark wallpapers.

---

## 🎬 How to record the demo:
1. **Show the Problem**:
   - Open `localhost:3000` in the browser.
   - Open the **Terminal** app and type `sysinfo` (it will say command not found).
   - Point out that there is no workspace banner on the desktop.

2. **Trigger the Agent**:
   - Go to your live dashboard and run the analysis for `POS-401` and `POS-402`.
   - The Agent will output the exact code changes and file paths.

3. **Apply the Code Changes**:
   - For `POS-401`: Create `packages/core/src/features/shell/commands/sysinfo.ts` and paste the suggested command logic.
   - For `POS-402`: Edit `packages/core/src/components/desktop/Desktop.tsx` and paste the banner div near the top of the return block.

4. **Verify Live on Camera**:
   - Go back to the browser.
   - Show the brand new **"Developer Sandbox Session"** banner floating on the desktop.
   - Open the terminal, type `sysinfo`, and hit enter to show it executing successfully!
