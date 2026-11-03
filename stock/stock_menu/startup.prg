// stock_menu — the default player menu (E-80).
// docs/spec/engine/plugins-and-battle.md#e-80-stock-menu
//
// The four screens are RPGCode `menuProviders` and the save/load picker is the `dirsav` command layer. Each
// provider is its screen's own blocking loop on the calling script thread: draw, `waitinput` for one key or pointer
// change, handle it, repeat. The package owns navigation and drawing only; party, inventory, equipment and
// menu state are read through the read-only provider context and changed only through the owner actions.
//
// The one cursor is the menu frame's `selection` (the focused list's cursor) and its `actorId` (the member being
// operated). A screen keeps its mode and the cursors it returns to as locals in its own `ui` dictionary, so nothing
// about a screen lives in a package global and nothing pushes an extra frame.
//
// Everything drawn goes into the reserved render-now overlay, whose previous pixels are stashed and restored when
// the screen closes, so the menu is one blit in the core draw list and holds no state a renderer could own.

stockMenu = {
    // ---- palette (A11Y-4: text and chrome meet 4.5:1 / 3:1 against the panel) --------------------------------
    panelR: 16,
    panelG: 16,
    panelB: 24,
    inkR: 232,
    inkG: 232,
    inkB: 240,
    dimR: 140,
    dimG: 140,
    dimB: 152,
    lineR: 88,
    lineG: 88,
    lineB: 104,
    barR: 40,
    barG: 64,
    barB: 140,
    markR: 255,
    markG: 224,
    markB: 64,

    // ---- layout (A11Y-7: a row is a 24 x 24 target; every position derives from w and h) --------------------
    rowH: 24,
    listTop: 24,
    labelX: 24,
    rowTop: 48,
    w: 0,
    h: 0,
    screen: 0,
    stash: 0,
    stashOn: 0,
    savedFont: 0,
    savedR: 0,
    savedG: 0,
    savedB: 0,
    screenName: "",
    message: "",
    closeAll: 0,
    context: null,
    charCache: {},
    itemCache: {},
    stackIds: {},
    stackHandles: {},
    stackSources: {},
    stackQty: {},
    stackCount: 0,
    itemcount: 0,
    moveFiles: {},
    listPositions: {},
    listHasRemove: 0,
    moveNames: {},
    moveCosts: {},
    moveCount: 0,
    memberIds: {},
    memberCount: 0,
    saveNames: {},
    saveCount: 0,

    // ---- drawing ---------------------------------------------------------------------------------------------
    box: (x1, y1, x2, y2, r, g, b) => {
        colorrgb(r, g, b)
        fillrect(x1, y1, x2, y2, stockMenu.screen)
        return 0
    },
    frame: (x1, y1, x2, y2, r, g, b) => {
        colorrgb(r, g, b)
        drawrect(x1, y1, x2, y2, stockMenu.screen)
        return 0
    },
    words: (x, y, text, size, r, g, b) => {
        colorrgb(r, g, b)
        fontsize(size)
        pixeltext(x, y, text, stockMenu.screen)
        return 0
    },
    panel: () => {
        stockMenu.box(8, 8, stockMenu.w - 9, stockMenu.h - 9, stockMenu.panelR, stockMenu.panelG, stockMenu.panelB)
        local(graphic) = ""
        if (stockMenu.context != null) {
            graphic = stockMenu.context.menu.graphic
        }
        if (graphic != 0 && graphic != "") {
            stockMenu.context.menu.drawGraphic(8, 8, stockMenu.w - 16, stockMenu.h - 16, stockMenu.screen)
        }
        stockMenu.frame(8, 8, stockMenu.w - 9, stockMenu.h - 9, stockMenu.lineR, stockMenu.lineG, stockMenu.lineB)
        return 0
    },
    // A row is the rectangle [16, w - 16) x [y - 4, y + 20): its text is at y and its focus bar fills the whole
    // rectangle, so rows tile exactly and the bar is the pointer hit rectangle (A11Y-5, A11Y-7).
    row: (y, label, value, focused, dim) => {
        local(r) = stockMenu.inkR
        local(g) = stockMenu.inkG
        local(b) = stockMenu.inkB
        local(text) = label
        if (dim != 0) {
            r = stockMenu.dimR
            g = stockMenu.dimG
            b = stockMenu.dimB
        }
        if (focused != 0) {
            stockMenu.box(16, y - 4, stockMenu.w - 17, y + 19, stockMenu.barR, stockMenu.barG, stockMenu.barB)
            r = stockMenu.markR
            g = stockMenu.markG
            b = stockMenu.markB
        }
        stockMenu.words(stockMenu.labelX, y, text, 16, r, g, b)
        if (value != "") {
            stockMenu.words(stockMenu.w - 168, y, value, 16, r, g, b)
        }
        return 0
    },
    header: (text) => {
        stockMenu.words(stockMenu.labelX, stockMenu.listTop, text, 18, stockMenu.markR, stockMenu.markG, stockMenu.markB)
        return 0
    },
    footer: () => {
        if (stockMenu.message != "") {
            stockMenu.words(stockMenu.labelX, stockMenu.h - 40, stockMenu.message, 16, stockMenu.markR, stockMenu.markG, stockMenu.markB)
        }
        return 0
    },
    clearPanel: () => {
        stockMenu.panel()
        return 0
    },

    // ---- paging (one viewport capacity for every list) -------------------------------------------------------
    // The rows that fit between the first row bar (y = 48) and the message line (y = h - 40): 6 at 320 x 240, 16 at 640 x 480.
    pageRows: () => {
        local(rows) = integermuldiv(stockMenu.h - 90, 1, stockMenu.rowH)
        if (rows < 1) {
            rows = 1
        }
        return rows
    },
    // The first row of the page that holds `selection`; a list that fits is one page.
    firstOf: (selection, rows, cap) => {
        if (rows <= cap) {
            return 0
        }
        return integermuldiv(selection, 1, cap) * cap
    },
    pager: (selection, rows, cap) => {
        if (rows > cap) {
            local(pages) = integermuldiv(rows + cap - 1, 1, cap)
            local(page) = integermuldiv(selection, 1, cap) + 1
            stockMenu.words(stockMenu.w - 168, stockMenu.listTop, "Page " + page + " of " + pages, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
        }
        return 0
    },
    // Draw one list: the header, the page that holds the cursor and the page indicator. `labels`, `values` and `dims`
    // are dictionaries indexed from 0 (value text and a 0/1 dim flag per row).
    list: (ui, title, labels, values, dims, rows, empty) => {
        local(selection) = stockMenu.getSel(ui)
        local(cap) = stockMenu.pageRows()
        local(first) = stockMenu.firstOf(selection, rows, cap)
        local(position) = 0
        local(y) = stockMenu.rowTop + 4
        ui.cap = cap
        ui.y0 = stockMenu.rowTop
        ui.rows = rows
        stockMenu.clearPanel()
        stockMenu.header(title)
        for (position = first; position < rows && position < first + cap; position = position + 1) {
            stockMenu.row(y, labels[position], values[position], selection == position, dims[position])
            y = y + stockMenu.rowH
        }
        if (rows == 0) {
            stockMenu.words(stockMenu.labelX, stockMenu.rowTop + 4, empty, 16, stockMenu.dimR, stockMenu.dimG, stockMenu.dimB)
        }
        stockMenu.pager(selection, rows, cap)
        stockMenu.footer()
        return 0
    },
    // A screen with no rows: a header and one line of text.
    note: (ui, title, text) => {
        ui.cap = stockMenu.pageRows()
        ui.y0 = stockMenu.rowTop
        ui.rows = 0
        stockMenu.clearPanel()
        stockMenu.header(title)
        stockMenu.words(stockMenu.labelX, stockMenu.rowTop + 4, text, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
        stockMenu.footer()
        return 0
    },

    // ---- frame lifecycle -------------------------------------------------------------------------------------
    begin: (context, screenName) => {
        local(parent) = {
            context: stockMenu.context, screenName: stockMenu.screenName, w: stockMenu.w, h: stockMenu.h,
            screen: stockMenu.screen, stash: stockMenu.stash, stashOn: stockMenu.stashOn,
            savedFont: stockMenu.savedFont, savedR: stockMenu.savedR, savedG: stockMenu.savedG, savedB: stockMenu.savedB,
            message: stockMenu.message, charCache: stockMenu.charCache, itemCache: stockMenu.itemCache
        }
        local(w) = 0
        local(h) = 0
        getres(w, h)
        stockMenu.context = context
        stockMenu.screenName = screenName
        stockMenu.w = w
        stockMenu.h = h
        stockMenu.message = ""
        stockMenu.savedFont = getfontsize()
        stockMenu.savedR = 0
        stockMenu.savedG = 0
        stockMenu.savedB = 0
        getcolor(stockMenu.savedR, stockMenu.savedG, stockMenu.savedB)
        stockMenu.stashOn = rendernowenabled()
        stockMenu.stash = 0
        if (cnvrendernow != 0) {
            stockMenu.stash = createcanvas(w, h)
            drawcanvas(cnvrendernow, 0, 0, w, h, stockMenu.stash)
        }
        rendernow(1)
        stockMenu.screen = cnvrendernow
        return parent
    },
    close: (parent) => {
        clear(stockMenu.screen)
        if (stockMenu.stash != 0) {
            drawcanvas(stockMenu.stash, 0, 0, stockMenu.w, stockMenu.h, stockMenu.screen)
            killcanvas(stockMenu.stash)
            stockMenu.stash = 0
        }
        if (stockMenu.stashOn == 0) {
            rendernow(0)
        }
        fontsize(stockMenu.savedFont)
        colorrgb(stockMenu.savedR, stockMenu.savedG, stockMenu.savedB)
        if (stockMenu.screenName != "picker") {
            if (stockMenu.context.menu.screens.length <= 1) {
                stockMenu.closeAll = 0
            }
        }
        stockMenu.context = parent.context
        stockMenu.screenName = parent.screenName
        stockMenu.w = parent.w
        stockMenu.h = parent.h
        stockMenu.screen = parent.screen
        stockMenu.stash = parent.stash
        stockMenu.stashOn = parent.stashOn
        stockMenu.savedFont = parent.savedFont
        stockMenu.savedR = parent.savedR
        stockMenu.savedG = parent.savedG
        stockMenu.savedB = parent.savedB
        stockMenu.message = parent.message
        stockMenu.charCache = parent.charCache
        stockMenu.itemCache = parent.itemCache
        return 0
    },
    // One key press, normalised: a game with bindings delivers action names, a game without delivers legacy names.
    normalize: (key) => {
        local(name) = "" + key
        if (name == "UP") { return "up" }
        if (name == "DOWN") { return "down" }
        if (name == "LEFT") { return "left" }
        if (name == "RIGHT") { return "right" }
        if (name == "ENTER") { return "confirm" }
        if (name == " ") { return "confirm" }
        if (name == "ESC") { return "cancel" }
        return name
    },
    // Menu cues are one-shot `ui` voices (R-59): they mix over music and `wavstop` does not stop them.
    cue: (kind) => {
        local(file) = ""
        if (stockMenu.context != null) {
            if (kind == "move") { file = stockMenu.context.menu.movesound }
            if (kind == "choose") { file = stockMenu.context.menu.choosesound }
            if (kind == "cancel") { file = stockMenu.context.menu.cancelsound }
        }
        if (file != "") {
            mediaplay(file, { track: "ui", loop: 0 })
        }
        return 0
    },

    // ---- the one cursor --------------------------------------------------------------------------------------
    // The frame's `selection`, or 0 when no frame exists.
    selection: () => {
        local(frames) = stockMenu.context.menu.screens
        if (frames.length < 1) {
            return 0
        }
        return frames[frames.length - 1].selection
    },
    // The frame's `actorId`, or null when no frame exists.
    actorOf: (context) => {
        local(frames) = context.menu.screens
        if (frames.length < 1) {
            return null
        }
        return frames[frames.length - 1].actorId
    },
    choose: (index) => {
        local(frames) = stockMenu.context.menu.screens
        local(actor) = null
        if (frames.length > 0) {
            actor = frames[frames.length - 1].actorId
        }
        stockMenu.context.menu.updateCurrent({ actorId: actor, selection: index })
        return 0
    },
    withMember: (actorId, index) => {
        stockMenu.context.menu.updateCurrent({ actorId: actorId, selection: index })
        return 0
    },
    // A screen's state: `framed` says whether a menu frame holds the cursor (the picker may run with none, and then
    // keeps a local `sel`), `follow` says the cursor is on a member list and the frame's actor follows it.
    newUi: (context) => {
        local(framed) = 0
        local(actor) = null
        if (context != null) {
            if (context.menu.screens.length > 0) {
                framed = 1
                actor = stockMenu.actorOf(context)
            }
        }
        local(ui) = {
            mode: "list", framed: framed, follow: 0, sel: 0, actor0: actor, actor: actor,
            last: null, pressed: -1, dirty: 1, cap: 1, y0: 48, rows: 0,
            memberSel: 0, slotSel: 0, stack: 0, stackSel: 0, actionSel: 0, move: 0, moveSel: 0
        }
        return ui
    },
    getSel: (ui) => {
        if (ui.framed == 1) {
            return stockMenu.selection()
        }
        return ui.sel
    },
    setSel: (ui, index) => {
        ui.dirty = 1
        if (ui.framed == 1) {
            if (ui.follow == 1) {
                stockMenu.withMember(stockMenu.memberIds[index], index)
            } else {
                stockMenu.choose(index)
            }
        } else {
            ui.sel = index
        }
        return 0
    },
    // Move to another list of the same screen: the mode, the member being operated and the cursor in the new list.
    enter: (ui, mode, actor, index, follow) => {
        ui.mode = mode
        ui.follow = follow
        ui.dirty = 1
        ui.pressed = -1
        if (ui.framed == 1) {
            stockMenu.withMember(actor, index)
        } else {
            ui.sel = index
        }
        return 0
    },
    // After any call that can block (a nested screen, a prompt, an item program) the pointer baseline is stale: take
    // the record as it is now, so an old press cannot be replayed on a screen that has changed.
    resync: (ui) => {
        ui.last = null
        ui.pressed = -1
        ui.dirty = 1
        return 0
    },
    wrap: (value, count) => {
        if (count < 1) {
            return 0
        }
        local(next) = value
        while (next < 0) {
            next = next + count
        }
        return next % count
    },
    // up/down wrap over the whole list; left/right turn one whole page and clamp. Returns 1 when the cursor moved
    // (a refused key is silent).
    nav: (ui, key, rows) => {
        local(selection) = stockMenu.getSel(ui)
        local(next) = selection
        local(cap) = stockMenu.pageRows()
        if (rows > 0) {
            if (key == "up") { next = stockMenu.wrap(selection - 1, rows) }
            if (key == "down") { next = stockMenu.wrap(selection + 1, rows) }
            if (rows > cap) {
                if (key == "left") {
                    next = selection - cap
                    if (next < 0) { next = 0 }
                }
                if (key == "right") {
                    next = selection + cap
                    if (next > rows - 1) { next = rows - 1 }
                }
            }
        }
        if (next != selection) {
            stockMenu.setSel(ui, next)
            stockMenu.cue("move")
            return 1
        }
        return 0
    },
    // Keep the cursor on a real row after the list shrank.
    clampSel: (ui, rows) => {
        local(selection) = stockMenu.getSel(ui)
        if (rows > 0) {
            if (selection >= rows) {
                stockMenu.setSel(ui, rows - 1)
            }
        }
        return 0
    },

    // ---- the pointer (E-111, menu navigation rule 3) ---------------------------------------------------------
    // The visible row under (x, y), or -1: rows tile the rectangle [16, w - 16) x [y0, y0 + 24 * visible).
    rowAt: (x, y, rows, first, y0, cap) => {
        if (x < 16) { return -1 }
        if (x >= stockMenu.w - 16) { return -1 }
        if (y < y0) { return -1 }
        local(k) = integermuldiv(y - y0, 1, stockMenu.rowH)
        if (k >= cap) { return -1 }
        if (first + k >= rows) { return -1 }
        return first + k
    },
    // One pointer event, turned into the keyboard's own vocabulary: hover and press move the cursor here, a release
    // over the row that was pressed returns "confirm" (the very path the keyboard takes), a secondary release returns
    // "cancel", and everything else returns "". A press only arms a row; leaving the row cancels the press for good.
    pointer: (ui, ev, rows, first, y0) => {
        local(result) = ""
        local(row) = -1
        local(primary) = 0
        local(selection) = stockMenu.getSel(ui)
        if (ev.newdowns > 0) {
            if (ev.button == 1) { primary = 1 }
            if (ev.buttons % 2 == 1) { primary = 1 }
            if (primary == 1) {
                row = stockMenu.rowAt(ev.downx, ev.downy, rows, first, y0, ui.cap)
                ui.pressed = row
                if (row >= 0) {
                    if (row != selection) {
                        stockMenu.setSel(ui, row)
                        stockMenu.cue("move")
                        selection = row
                    }
                }
            }
        }
        if (ev.moved == 1) {
            row = stockMenu.rowAt(ev.x, ev.y, rows, first, y0, ui.cap)
            if (ui.pressed >= 0) {
                if (row != ui.pressed) {
                    ui.pressed = -1
                }
            }
            if (row >= 0) {
                if (row != selection) {
                    stockMenu.setSel(ui, row)
                    stockMenu.cue("move")
                    selection = row
                }
            }
        }
        if (ev.newups > 0) {
            if (ev.button == 2) {
                result = "cancel"
            }
            if (ev.button == 1) {
                if (ui.pressed >= 0) {
                    row = stockMenu.rowAt(ev.x, ev.y, rows, first, y0, ui.cap)
                    if (row == ui.pressed) {
                        if (row != selection) {
                            stockMenu.setSel(ui, row)
                        }
                        result = "confirm"
                    }
                }
                ui.pressed = -1
            }
        }
        return result
    },
    // The one input wait of every screen: one key (normalised) or one pointer change.
    read: (ui) => {
        local(ev) = waitinput(ui.last)
        local(key) = ""
        local(first) = 0
        ui.last = ev
        if (ev.kind == "key") {
            key = stockMenu.normalize(ev.key)
        } else {
            first = stockMenu.firstOf(stockMenu.getSel(ui), ui.rows, ui.cap)
            key = stockMenu.pointer(ui, ev, ui.rows, first, ui.y0)
        }
        if (key != "") {
            stockMenu.message = ""
            ui.dirty = 1
        }
        return key
    },

    // ---- owner data ------------------------------------------------------------------------------------------
    members: (context) => {
        local(list) = context.party.members
        local(count) = list.length
        local(index) = 0
        stockMenu.memberCount = count
        stockMenu.memberIds = {}
        for (index = 0; index < count; index = index + 1) {
            stockMenu.memberIds[index] = list[index].id
        }
        return list
    },
    stacks: (context) => {
        local(items) = context.inventory.items
        local(total) = items.length
        local(index) = 0
        local(position) = 0
        local(entry)
        local(before)
        local(count) = 0
        stockMenu.stackCount = 0
        stockMenu.stackIds = {}
        stockMenu.stackHandles = {}
        stockMenu.stackSources = {}
        stockMenu.stackQty = {}
        for (index = 0; index < total; index = index + 1) {
            entry = items[index]
            if (entry.quantity > 0) {
                // Ascending stack id, by insertion: the section keeps creation order, but a save may restore any order.
                position = count
                while (position > 0 && stockMenu.stackIds[position - 1] > entry.id) {
                    stockMenu.stackIds[position] = stockMenu.stackIds[position - 1]
                    stockMenu.stackHandles[position] = stockMenu.stackHandles[position - 1]
                    stockMenu.stackSources[position] = stockMenu.stackSources[position - 1]
                    stockMenu.stackQty[position] = stockMenu.stackQty[position - 1]
                    position = position - 1
                }
                stockMenu.stackIds[position] = entry.id
                stockMenu.stackHandles[position] = entry.handle
                stockMenu.stackSources[position] = entry.source
                stockMenu.stackQty[position] = entry.quantity
                count = count + 1
            }
        }
        stockMenu.stackCount = count
        return count
    },
    itemData: (source) => {
        local(cached) = stockMenu.itemCache[source]
        if (cached != null) {
            return cached
        }
        local(data) = menuitemdata(source)
        if (data == null) {
            data = { name: "", description: "", buyprice: 0, sellprice: 0, keyitem: 0, menuy: 0, equipable: 0, slots: {}, accessory: "", usedby: 0, allowed: {} }
        }
        stockMenu.itemCache[source] = data
        return data
    },
    characterData: (source, actorId) => {
        local(key) = source + "|" + actorId
        local(cached) = stockMenu.charCache[key]
        if (cached != null) {
            return cached
        }
        local(data) = menucharacterdata(source, actorId)
        if (data == null) {
            data = { name: "", portrait: "", bodyslots: {}, accessoryslots: {}, specialname: "", hasspecial: 0, specialcount: 0, specialmoves: {} }
        }
        stockMenu.charCache[key] = data
        return data
    },
    equippedAt: (context, actorId, slot) => {
        local(equipment) = context.inventory.equipment
        local(index) = 0
        for (index = 0; index < equipment.length; index = index + 1) {
            if (equipment[index].actorId == actorId && equipment[index].slot == slot) {
                return equipment[index].itemId
            }
        }
        return 0
    },
    // The handle of the inventory entry an equipped tuple names. A stack whose every unit is equipped has quantity 0,
    // so this reads every entry, not only the listed stacks.
    handleOfEntry: (context, itemId) => {
        local(items) = context.inventory.items
        local(index) = 0
        for (index = 0; index < items.length; index = index + 1) {
            if (items[index].id == itemId) {
                return items[index].handle
            }
        }
        return "-"
    },
    slotTokens: {},
    // E-82: the item's own flag for the slot, the member's own slot, and (for accessories) the matching name.
    fits: (item, character, slot) => {
        if (item.equipable != 1) {
            return 0
        }
        if (slot == "head") { return item.slots.head == 1 && character.bodyslots.head == 1 }
        if (slot == "neck") { return item.slots.neck == 1 && character.bodyslots.neck == 1 }
        if (slot == "right-hand") { return item.slots["right-hand"] == 1 && character.bodyslots["right-hand"] == 1 }
        if (slot == "left-hand") { return item.slots["left-hand"] == 1 && character.bodyslots["left-hand"] == 1 }
        if (slot == "body") { return item.slots.body == 1 && character.bodyslots.body == 1 }
        if (slot == "legs") { return item.slots.legs == 1 && character.bodyslots.legs == 1 }
        if (item.slots.accessory != 1) {
            return 0
        }
        if (item.accessory == "") {
            return 0
        }
        return character.accessoryslots[slot] == item.accessory
    },
    timeText: (seconds) => {
        local(hours) = integermuldiv(seconds, 1, 3600)
        local(minutes) = integermuldiv(seconds - hours * 3600, 1, 60)
        local(secs) = seconds - hours * 3600 - minutes * 60
        local(mm) = "" + minutes
        local(ss) = "" + secs
        if (minutes < 10) { mm = "0" + minutes }
        if (secs < 10) { ss = "0" + secs }
        return hours + ":" + mm + ":" + ss
    },
    // The names of the party members as list rows.
    memberRows: (context, labels, values, dims) => {
        local(members) = stockMenu.members(context)
        local(index) = 0
        for (index = 0; index < stockMenu.memberCount; index = index + 1) {
            labels[index] = members[index].name
            values[index] = ""
            dims[index] = 0
        }
        return stockMenu.memberCount
    },

    // ---- the main screen -------------------------------------------------------------------------------------
    // Layout: the top line (Gold and Time, or the message), the party block in 18-pixel lines, and the six commands
    // pinned to the bottom of the panel so they never move: the last bar ends at y = h - 11.
    drawMain: (context, ui) => {
        local(members) = stockMenu.members(context)
        local(index) = 0
        local(y) = 0
        local(member)
        local(portrait)
        local(caption)
        local(labels) = {}
        local(values) = {}
        local(dims) = {}
        local(commandTop) = stockMenu.h - 155
        local(lines) = integermuldiv(stockMenu.h - 203, 1, 18)
        local(shown) = stockMenu.memberCount
        local(extra) = 0
        local(selection) = stockMenu.getSel(ui)
        if (ui.mode == "quit") {
            labels[0] = "No"
            labels[1] = "Yes"
            values[0] = ""
            values[1] = ""
            dims[0] = 0
            dims[1] = 0
            stockMenu.list(ui, "Quit the game?", labels, values, dims, 2, "")
            return 0
        }
        labels[0] = "Items"
        labels[1] = "Equip"
        labels[2] = "Abilities"
        labels[3] = "Save"
        labels[4] = "Load"
        labels[5] = "Quit"
        for (index = 0; index < 6; index = index + 1) {
            values[index] = ""
            dims[index] = 0
        }
        if (context.menu.saveallowed == 0) {
            dims[3] = 1
        }
        if (lines < 1) {
            lines = 1
        }
        if (shown > lines) {
            shown = lines - 1
            if (shown < 1) {
                shown = 1
            }
            extra = stockMenu.memberCount - shown
        }
        ui.cap = 6
        ui.y0 = commandTop
        ui.rows = 6
        stockMenu.clearPanel()
        if (stockMenu.message != "") {
            stockMenu.words(stockMenu.labelX, stockMenu.listTop, stockMenu.message, 16, stockMenu.markR, stockMenu.markG, stockMenu.markB)
        } else {
            stockMenu.words(stockMenu.labelX, stockMenu.listTop, "Gold " + context.inventory.gold, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
            stockMenu.words(stockMenu.w - 168, stockMenu.listTop, "Time " + stockMenu.timeText(gametime), 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
        }
        y = 44
        for (index = 0; index < shown; index = index + 1) {
            member = members[index]
            caption = member.name + "  HP " + member.hp + "/" + member.maxhp + "  SMP " + member.smp + "/" + member.maxsmp + "  Lv " + member.level
            stockMenu.words(44, y, caption, 16, stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
            portrait = stockMenu.characterData(member.source, member.id).portrait
            if (portrait != 0 && portrait != "") {
                setimage(portrait, 24, y, 16, 16, stockMenu.screen)
            }
            y = y + 18
        }
        if (extra > 0) {
            stockMenu.words(stockMenu.labelX, y, "+" + extra + " more", 16, stockMenu.dimR, stockMenu.dimG, stockMenu.dimB)
        }
        y = commandTop + 4
        for (index = 0; index < 6; index = index + 1) {
            stockMenu.row(y, labels[index], values[index], selection == index, dims[index])
            y = y + stockMenu.rowH
        }
        return 0
    },
    mainScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(name) = ""
        local(selection) = 0
        local(parent) = stockMenu.begin(context, "main")
        local(ui) = stockMenu.newUi(context)
        while (done == 0) {
            if (ui.dirty == 1) {
                stockMenu.drawMain(context, ui)
                ui.dirty = 0
            }
            key = stockMenu.read(ui)
            if (key != "") {
                selection = stockMenu.getSel(ui)
                if (ui.mode == "quit") {
                    stockMenu.nav(ui, key, 2)
                    if (key == "cancel") {
                        stockMenu.enter(ui, "list", ui.actor0, 5, 0)
                        stockMenu.cue("cancel")
                    }
                    if (key == "menu") {
                        done = 1
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (selection == 1) {
                            done = 1
                            stockMenu.cue("choose")
                            dos()
                        } else {
                            stockMenu.enter(ui, "list", ui.actor0, 5, 0)
                            stockMenu.cue("cancel")
                        }
                    }
                    key = ""
                }
                stockMenu.nav(ui, key, 6)
                if (key == "menu") {
                    done = 1
                    stockMenu.cue("cancel")
                }
                if (key == "cancel") {
                    done = 1
                    stockMenu.cue("cancel")
                }
                if (key == "confirm") {
                    if (selection == 0) {
                        stockMenu.cue("choose")
                        itemmenu()
                        if (stockMenu.closeAll == 1) { done = 1 }
                        stockMenu.resync(ui)
                    }
                    if (selection == 1) {
                        stockMenu.cue("choose")
                        equipmentmenu()
                        if (stockMenu.closeAll == 1) { done = 1 }
                        stockMenu.resync(ui)
                    }
                    if (selection == 2) {
                        stockMenu.cue("choose")
                        abilitiesmenu()
                        if (stockMenu.closeAll == 1) { done = 1 }
                        stockMenu.resync(ui)
                    }
                    if (selection == 3) {
                        if (context.menu.saveallowed == 0) {
                            stockMenu.message = "Saving is not allowed here"
                            stockMenu.cue("cancel")
                        } else {
                            stockMenu.cue("choose")
                            name = dirsav("Save game", 1, 0, 0, "")
                            if (stockMenu.closeAll == 1) { done = 1 }
                            if (name != "CANCEL") {
                                save(name)
                                stockMenu.message = "Saved " + name
                            }
                            stockMenu.resync(ui)
                        }
                    }
                    if (selection == 4) {
                        stockMenu.cue("choose")
                        name = dirsav("Load game", 0, 0, 0, "")
                        if (stockMenu.closeAll == 1) { done = 1 }
                        if (name != "CANCEL") {
                            load(name)
                            done = 1
                        }
                        stockMenu.resync(ui)
                    }
                    if (selection == 5) {
                        stockMenu.enter(ui, "quit", ui.actor0, 0, 0)
                        stockMenu.cue("choose")
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the items screen ------------------------------------------------------------------------------------
    drawItems: (context, ui) => {
        local(count) = stockMenu.stacks(context)
        local(index) = 0
        local(labels) = {}
        local(values) = {}
        local(dims) = {}
        local(data)
        if (ui.mode == "list") {
            stockMenu.clampSel(ui, count)
            for (index = 0; index < count; index = index + 1) {
                labels[index] = stockMenu.stackHandles[index]
                values[index] = "x " + stockMenu.stackQty[index]
                dims[index] = 0
            }
            stockMenu.list(ui, "Items", labels, values, dims, count, "Nothing carried")
        }
        if (ui.mode == "action") {
            labels[0] = "Use"
            labels[1] = "Info"
            labels[2] = "Drop"
            for (index = 0; index < 3; index = index + 1) {
                values[index] = ""
                dims[index] = 0
            }
            stockMenu.list(ui, stockMenu.stackHandles[ui.stack], labels, values, dims, 3, "")
        }
        if (ui.mode == "member") {
            count = stockMenu.memberRows(context, labels, values, dims)
            stockMenu.list(ui, "Use on", labels, values, dims, count, "")
        }
        if (ui.mode == "info") {
            data = stockMenu.itemData(stockMenu.stackSources[ui.stack])
            if (data.description == "") {
                stockMenu.note(ui, stockMenu.stackHandles[ui.stack], stockMenu.stackHandles[ui.stack])
            } else {
                stockMenu.note(ui, stockMenu.stackHandles[ui.stack], data.description)
            }
        }
        return 0
    },
    itemScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(selection) = 0
        local(result)
        local(data)
        local(actorId) = 0
        local(parent) = stockMenu.begin(context, "items")
        local(ui) = stockMenu.newUi(context)
        while (done == 0) {
            if (ui.dirty == 1) {
                stockMenu.drawItems(context, ui)
                ui.dirty = 0
            }
            key = stockMenu.read(ui)
            if (key != "") {
                selection = stockMenu.getSel(ui)
                if (ui.mode == "list") {
                    stockMenu.nav(ui, key, stockMenu.stackCount)
                    if (key == "confirm") {
                        if (stockMenu.stackCount > 0) {
                            ui.stackSel = selection
                            ui.stack = selection
                            stockMenu.enter(ui, "action", ui.actor0, 0, 0)
                            stockMenu.cue("choose")
                        }
                    }
                    if (key == "cancel" || key == "menu") {
                        done = 1
                        if (key == "menu") { stockMenu.closeAll = 1 }
                        stockMenu.cue("cancel")
                    }
                } else {
                    if (ui.mode == "action") {
                        stockMenu.nav(ui, key, 3)
                        if (key == "cancel") {
                            stockMenu.enter(ui, "list", ui.actor0, ui.stackSel, 0)
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            done = 1
                            stockMenu.closeAll = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            if (selection == 0) {
                                if (stockMenu.stackQty[ui.stack] < 1) {
                                    stockMenu.message = "Nothing to use"
                                    stockMenu.cue("cancel")
                                } else {
                                    ui.actionSel = 0
                                    stockMenu.members(context)
                                    stockMenu.enter(ui, "member", stockMenu.memberIds[0], 0, 1)
                                    stockMenu.cue("choose")
                                }
                            }
                            if (selection == 1) {
                                ui.actionSel = 1
                                stockMenu.enter(ui, "info", ui.actor0, 1, 0)
                                stockMenu.cue("choose")
                            }
                            if (selection == 2) {
                                data = stockMenu.itemData(stockMenu.stackSources[ui.stack])
                                if (data.keyitem != 0) {
                                    stockMenu.message = "Key items cannot be dropped"
                                    stockMenu.cue("cancel")
                                } else {
                                    if (stockMenu.stackQty[ui.stack] < 1) {
                                        stockMenu.message = "Nothing to drop"
                                        stockMenu.cue("cancel")
                                    } else {
                                        context.inventory.removeItem({ entryId: stockMenu.stackIds[ui.stack], amount: 1 })
                                        stockMenu.message = "Dropped " + stockMenu.stackHandles[ui.stack]
                                        stockMenu.enter(ui, "list", ui.actor0, ui.stackSel, 0)
                                        stockMenu.cue("choose")
                                    }
                                }
                            }
                        }
                    } else {
                        if (ui.mode == "member") {
                            stockMenu.nav(ui, key, stockMenu.memberCount)
                            if (key == "cancel") {
                                stockMenu.enter(ui, "action", ui.actor0, ui.actionSel, 0)
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                done = 1
                                stockMenu.closeAll = 1
                                stockMenu.cue("cancel")
                            }
                            if (key == "confirm") {
                                if (stockMenu.memberCount > 0) {
                                    actorId = stockMenu.memberIds[selection]
                                    result = context.inventory.use({ entryId: stockMenu.stackIds[ui.stack], actorId: actorId })
                                    if (result.status == "complete") {
                                        stockMenu.message = "Used " + stockMenu.stackHandles[ui.stack]
                                        stockMenu.enter(ui, "list", ui.actor0, ui.stackSel, 0)
                                        stockMenu.cue("choose")
                                    } else {
                                        stockMenu.message = result.error.message
                                        stockMenu.cue("cancel")
                                    }
                                    stockMenu.resync(ui)
                                }
                            }
                        } else {
                            if (ui.mode == "info") {
                                if (key == "cancel") {
                                    stockMenu.enter(ui, "action", ui.actor0, ui.actionSel, 0)
                                    stockMenu.cue("cancel")
                                }
                                if (key == "menu") {
                                    done = 1
                                    stockMenu.closeAll = 1
                                    stockMenu.cue("cancel")
                                }
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the equipment screen --------------------------------------------------------------------------------
    drawEquipment: (context, ui) => {
        local(index) = 0
        local(actorId) = 0
        local(slot) = ""
        local(itemId) = 0
        local(position) = 0
        local(shown) = 0
        local(labels) = {}
        local(values) = {}
        local(dims) = {}
        local(count) = 0
        stockMenu.members(context)
        if (ui.mode == "member") {
            count = stockMenu.memberRows(context, labels, values, dims)
            stockMenu.list(ui, "Equip", labels, values, dims, count, "")
        }
        if (ui.mode == "slot") {
            stockMenu.stacks(context)
            for (index = 0; index < 16; index = index + 1) {
                slot = stockMenu.slotTokens[index]
                itemId = stockMenu.equippedAt(context, ui.actor, slot)
                labels[index] = slot
                values[index] = "-"
                dims[index] = 0
                if (itemId != 0) {
                    values[index] = stockMenu.handleOfEntry(context, itemId)
                }
            }
            stockMenu.list(ui, "Slot", labels, values, dims, 16, "")
        }
        if (ui.mode == "item") {
            slot = stockMenu.slotTokens[ui.slotSel]
            stockMenu.buildItemList(context, ui)
            shown = 0
            if (stockMenu.listHasRemove == 1) {
                labels[0] = "Remove"
                values[0] = ""
                dims[0] = 0
                shown = 1
            }
            for (position = 0; position < stockMenu.itemcount; position = position + 1) {
                labels[shown] = stockMenu.stackHandles[stockMenu.listPositions[position]]
                values[shown] = ""
                dims[shown] = 0
                shown = shown + 1
            }
            stockMenu.clampSel(ui, shown)
            stockMenu.list(ui, slot, labels, values, dims, shown, "Nothing fits")
        }
        return 0
    },
    // The stacks whose definition fits the chosen slot for this character, in stack-id order (E-82 filter).
    buildItemList: (context, ui) => {
        local(actorId) = ui.actor
        local(slot) = stockMenu.slotTokens[ui.slotSel]
        local(member) = stockMenu.members(context)[ui.memberSel]
        local(character) = stockMenu.characterData(member.source, actorId)
        local(position) = 0
        local(data)
        local(usable) = 0
        stockMenu.stacks(context)
        stockMenu.itemcount = 0
        stockMenu.listPositions = {}
        stockMenu.listHasRemove = 0
        if (stockMenu.equippedAt(context, actorId, slot) != 0) {
            stockMenu.listHasRemove = 1
        }
        for (position = 0; position < stockMenu.stackCount; position = position + 1) {
            data = stockMenu.itemData(stockMenu.stackSources[position])
            usable = 0
            if (stockMenu.fits(data, character, slot) == 1) {
                usable = 1
                if (data.usedby == 1 && stockMenu.namesInclude(data.allowed, member.name) != 1) {
                    usable = 0
                }
            }
            if (usable == 1) {
                stockMenu.listPositions[stockMenu.itemcount] = position
                stockMenu.itemcount = stockMenu.itemcount + 1
            }
        }
        return stockMenu.itemcount
    },
    equipmentScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(slot) = ""
        local(result)
        local(position) = 0
        local(shown) = 0
        local(selection) = 0
        local(parent) = stockMenu.begin(context, "equipment")
        local(ui) = stockMenu.newUi(context)
        ui.mode = "member"
        ui.follow = 1
        while (done == 0) {
            if (ui.dirty == 1) {
                stockMenu.drawEquipment(context, ui)
                ui.dirty = 0
            }
            key = stockMenu.read(ui)
            if (key != "") {
                selection = stockMenu.getSel(ui)
                if (ui.mode == "member") {
                    stockMenu.nav(ui, key, stockMenu.memberCount)
                    if (key == "cancel" || key == "menu") {
                        done = 1
                        if (key == "menu") { stockMenu.closeAll = 1 }
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (stockMenu.memberCount > 0) {
                            ui.memberSel = selection
                            ui.actor = stockMenu.memberIds[selection]
                            stockMenu.enter(ui, "slot", ui.actor, 0, 0)
                            stockMenu.cue("choose")
                        }
                    }
                } else {
                    if (ui.mode == "slot") {
                        stockMenu.nav(ui, key, 16)
                        if (key == "cancel") {
                            stockMenu.enter(ui, "member", ui.actor, ui.memberSel, 1)
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            done = 1
                            stockMenu.closeAll = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            ui.slotSel = selection
                            stockMenu.enter(ui, "item", ui.actor, 0, 0)
                            stockMenu.cue("choose")
                        }
                    } else {
                        if (ui.mode == "item") {
                            slot = stockMenu.slotTokens[ui.slotSel]
                            shown = stockMenu.itemcount
                            if (stockMenu.listHasRemove == 1) {
                                shown = shown + 1
                            }
                            stockMenu.nav(ui, key, shown)
                            if (key == "cancel") {
                                stockMenu.enter(ui, "slot", ui.actor, ui.slotSel, 0)
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                done = 1
                                stockMenu.closeAll = 1
                                stockMenu.cue("cancel")
                            }
                            if (key == "confirm") {
                                result = null
                                if (stockMenu.listHasRemove == 1 && selection == 0) {
                                    result = context.inventory.removeEquipment({ actorId: ui.actor, slot: slot })
                                } else {
                                    position = selection
                                    if (stockMenu.listHasRemove == 1) {
                                        position = selection - 1
                                    }
                                    if (position < stockMenu.itemcount) {
                                        result = context.inventory.replace({ entryId: stockMenu.stackIds[stockMenu.listPositions[position]], actorId: ui.actor, slot: slot })
                                    }
                                }
                                if (result != null) {
                                    if (result.status == "complete") {
                                        stockMenu.enter(ui, "slot", ui.actor, ui.slotSel, 0)
                                        stockMenu.message = "Equipped"
                                        stockMenu.cue("choose")
                                    } else {
                                        stockMenu.message = result.error.message
                                        stockMenu.cue("cancel")
                                    }
                                    stockMenu.resync(ui)
                                }
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },
    namesInclude: (allowed, name) => {
        local(index) = 0
        for (index = 0; index < allowed.length; index = index + 1) {
            if (allowed[index] == name) {
                return 1
            }
        }
        return 0
    },

    // ---- the abilities screen --------------------------------------------------------------------------------
    moves: (context, member) => {
        local(data) = stockMenu.characterData(member.source, member.id)
        local(slots) = data.specialmoves
        local(index) = 0
        local(count) = slots.length
        local(move)
        local(spc)
        stockMenu.moveCount = 0
        stockMenu.moveFiles = {}
        stockMenu.moveNames = {}
        stockMenu.moveCosts = {}
        for (index = 0; index < count; index = index + 1) {
            move = slots[index]
            if (move.available == 1) {
                spc = battlemovedata(move.file)
                if (spc != null) {
                    // The `.spc` menu byte decides usability from the menu: 0 is usable, non-zero is not.
                    if (spc.menu == 0) {
                        stockMenu.moveFiles[stockMenu.moveCount] = move.file
                        stockMenu.moveNames[stockMenu.moveCount] = move.file
                        if (spc.name != "") {
                            stockMenu.moveNames[stockMenu.moveCount] = spc.name
                        }
                        stockMenu.moveCosts[stockMenu.moveCount] = spc.smp
                        stockMenu.moveCount = stockMenu.moveCount + 1
                    }
                }
            }
        }
        return 0
    },
    moveDescription: (file) => {
        local(spc) = battlemovedata(file)
        if (spc == null) {
            return ""
        }
        return spc.description
    },
    drawAbilities: (context, ui) => {
        local(index) = 0
        local(labels) = {}
        local(values) = {}
        local(dims) = {}
        local(count) = 0
        local(text) = ""
        if (ui.mode == "member") {
            count = stockMenu.memberRows(context, labels, values, dims)
            stockMenu.list(ui, "Abilities", labels, values, dims, count, "")
        }
        if (ui.mode == "list") {
            for (index = 0; index < stockMenu.moveCount; index = index + 1) {
                labels[index] = stockMenu.moveNames[index]
                values[index] = "SMP " + stockMenu.moveCosts[index]
                dims[index] = 0
            }
            stockMenu.list(ui, "Abilities", labels, values, dims, stockMenu.moveCount, "No usable moves")
        }
        if (ui.mode == "action") {
            labels[0] = "Use"
            labels[1] = "Info"
            for (index = 0; index < 2; index = index + 1) {
                values[index] = ""
                dims[index] = 0
            }
            stockMenu.list(ui, stockMenu.moveNames[ui.move], labels, values, dims, 2, "")
        }
        if (ui.mode == "info") {
            text = stockMenu.moveDescription(stockMenu.moveFiles[ui.move])
            if (text == "") {
                text = stockMenu.moveNames[ui.move]
            }
            stockMenu.note(ui, stockMenu.moveNames[ui.move], text)
        }
        return 0
    },
    abilitiesScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(member)
        local(spc)
        local(program) = ""
        local(selection) = 0
        local(parent) = stockMenu.begin(context, "abilities")
        local(ui) = stockMenu.newUi(context)
        ui.mode = "member"
        ui.follow = 1
        while (done == 0) {
            if (ui.dirty == 1) {
                stockMenu.drawAbilities(context, ui)
                ui.dirty = 0
            }
            key = stockMenu.read(ui)
            if (key != "") {
                selection = stockMenu.getSel(ui)
                if (ui.mode == "member") {
                    stockMenu.nav(ui, key, stockMenu.memberCount)
                    if (key == "cancel" || key == "menu") {
                        done = 1
                        if (key == "menu") { stockMenu.closeAll = 1 }
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (stockMenu.memberCount > 0) {
                            member = stockMenu.members(context)[selection]
                            ui.memberSel = selection
                            ui.actor = member.id
                            stockMenu.moves(context, member)
                            stockMenu.enter(ui, "list", ui.actor, 0, 0)
                            stockMenu.cue("choose")
                        }
                    }
                } else {
                    if (ui.mode == "list") {
                        stockMenu.nav(ui, key, stockMenu.moveCount)
                        if (key == "cancel") {
                            stockMenu.enter(ui, "member", ui.actor, ui.memberSel, 1)
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            done = 1
                            stockMenu.closeAll = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            if (stockMenu.moveCount > 0) {
                                ui.moveSel = selection
                                ui.move = selection
                                stockMenu.enter(ui, "action", ui.actor, 0, 0)
                                stockMenu.cue("choose")
                            }
                        }
                    } else {
                        if (ui.mode == "action") {
                            stockMenu.nav(ui, key, 2)
                            if (key == "cancel") {
                                stockMenu.enter(ui, "list", ui.actor, ui.moveSel, 0)
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                done = 1
                                stockMenu.closeAll = 1
                                stockMenu.cue("cancel")
                            }
                            if (key == "confirm") {
                                if (selection == 1) {
                                    ui.actionSel = 1
                                    stockMenu.enter(ui, "info", ui.actor, 1, 0)
                                    stockMenu.cue("choose")
                                } else {
                                    spc = battlemovedata(stockMenu.moveFiles[ui.move])
                                    program = ""
                                    if (spc != null) {
                                        program = spc.program
                                    }
                                    if (program == "") {
                                        stockMenu.message = "Nothing happens"
                                    } else {
                                        member = stockMenu.members(context)[ui.memberSel]
                                        executeprogram(program, { source: "" + member.handle, target: "" + member.handle })
                                        stockMenu.message = "Used " + stockMenu.moveNames[ui.move]
                                    }
                                    stockMenu.enter(ui, "list", ui.actor, ui.moveSel, 0)
                                    stockMenu.cue("choose")
                                    stockMenu.resync(ui)
                                }
                            }
                        } else {
                            if (ui.mode == "info") {
                                if (key == "cancel") {
                                    stockMenu.enter(ui, "action", ui.actor, ui.actionSel, 0)
                                    stockMenu.cue("cancel")
                                }
                                if (key == "menu") {
                                    done = 1
                                    stockMenu.closeAll = 1
                                    stockMenu.cue("cancel")
                                }
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the shop screen (E-83, #1234) -----------------------------------------------------------------------
    // The screen presents the session an active `CallShop` command owns: one row per `context.shop.stock` entry with
    // the name and both prices, the party's gold on the bottom right, then Buy/Sell and an amount row per unit.
    // Transactions go through the inventory owner only; leaving the list clears the stock so the caller resumes.
    shopLoad: (context) => {
        local(stock) = context.shop.stock
        local(total) = stock.length
        local(index) = 0
        local(entry)
        local(data)
        stockMenu.shopSources = {}
        stockMenu.shopNames = {}
        stockMenu.shopBuy = {}
        stockMenu.shopSell = {}
        stockMenu.shopCount = total
        for (index = 0; index < total; index = index + 1) {
            entry = stock[index]
            stockMenu.shopSources[index] = entry.source
            data = stockMenu.itemData(entry.source)
            stockMenu.shopNames[index] = data.name
            if (data.name == "") {
                stockMenu.shopNames[index] = entry.source
            }
            stockMenu.shopBuy[index] = data.buyprice
            stockMenu.shopSell[index] = data.sellprice
        }
        return total
    },
    // The available units of one source, and the lowest stack id holding them (the E-83 sell target).
    shopHeld: (context, source) => {
        local(items) = context.inventory.items
        local(total) = 0
        local(index) = 0
        stockMenu.shopEntryId = 0
        stockMenu.shopAvailable = 0
        for (index = 0; index < items.length; index = index + 1) {
            if (items[index].source == source && items[index].quantity > 0) {
                total = total + items[index].quantity
                if (stockMenu.shopEntryId == 0 || items[index].id < stockMenu.shopEntryId) {
                    stockMenu.shopEntryId = items[index].id
                }
            }
        }
        stockMenu.shopAvailable = total
        return total
    },
    shopGold: (context) => {
        stockMenu.words(stockMenu.w - 168, stockMenu.h - 40, "Gold " + context.inventory.gold, 16,
        stockMenu.inkR, stockMenu.inkG, stockMenu.inkB)
        return 0
    },
    drawShop: (context, ui) => {
        local(index) = 0
        local(amount) = 0
        local(total) = 0
        local(price) = 0
        local(labels) = {}
        local(values) = {}
        local(dims) = {}
        local(available) = 0
        local(count) = stockMenu.shopLoad(context)
        if (ui.mode == "list") {
            stockMenu.clampSel(ui, count)
            for (index = 0; index < count; index = index + 1) {
                labels[index] = stockMenu.shopNames[index]
                values[index] = "Buy " + stockMenu.shopBuy[index] + " / Sell " + stockMenu.shopSell[index]
                dims[index] = 0
                if (stockMenu.shopBuy[index] < 0 || stockMenu.shopSell[index] < 0) {
                    dims[index] = 1
                }
            }
            stockMenu.list(ui, "Shop", labels, values, dims, count, "Nothing for sale")
            stockMenu.shopGold(context)
        }
        if (ui.mode == "action") {
            available = stockMenu.shopHeld(context, stockMenu.shopSources[ui.stack])
            labels[0] = "Buy"
            labels[1] = "Sell"
            values[0] = "" + stockMenu.shopBuy[ui.stack] + " GP each"
            values[1] = "" + stockMenu.shopSell[ui.stack] + " GP each"
            dims[0] = 0
            dims[1] = 0
            if (available < 1) {
                dims[1] = 1
            }
            stockMenu.list(ui, stockMenu.shopNames[ui.stack], labels, values, dims, 2, "")
            stockMenu.shopGold(context)
        }
        if (ui.mode == "amount") {
            if (ui.action == "buy") {
                price = stockMenu.shopBuy[ui.stack]
            } else {
                price = stockMenu.shopSell[ui.stack]
                available = stockMenu.shopHeld(context, stockMenu.shopSources[ui.stack])
            }
            for (index = 0; index < 9; index = index + 1) {
                amount = index + 1
                total = price * amount
                labels[index] = "" + amount
                values[index] = "" + amount + " x " + price + " = " + total + " GP"
                dims[index] = 0
                if (ui.action == "buy" && total > context.inventory.gold) {
                    dims[index] = 1
                }
                if (ui.action == "sell" && amount > available) {
                    dims[index] = 1
                }
            }
            stockMenu.list(ui, stockMenu.shopNames[ui.stack], labels, values, dims, 9, "")
            stockMenu.shopGold(context)
            // The message line carries the focused row's own total, so the price to pay is always visible.
            stockMenu.words(stockMenu.labelX, stockMenu.h - 40, values[stockMenu.getSel(ui)], 16,
            stockMenu.markR, stockMenu.markG, stockMenu.markB)
        }
        return 0
    },
    shopScreen: (context) => {
        local(key) = ""
        local(done) = 0
        local(selection) = 0
        local(amount) = 0
        local(price) = 0
        local(total) = 0
        local(available) = 0
        local(name) = ""
        local(parent) = stockMenu.begin(context, "shop")
        local(ui) = stockMenu.newUi(context)
        // The shop's own screen state is created here, not in the shared helpers, so no other screen's
        // recorded state changes when the shop screen exists (golden/epic8/acceptance.json).
        ui.amount = 1
        ui.action = "buy"
        while (done == 0) {
            if (ui.dirty == 1) {
                stockMenu.drawShop(context, ui)
                ui.dirty = 0
            }
            key = stockMenu.read(ui)
            if (key != "") {
                selection = stockMenu.getSel(ui)
                if (ui.mode == "list") {
                    stockMenu.nav(ui, key, stockMenu.shopCount)
                    if (key == "cancel" || key == "menu") {
                        context.shop.close()
                        done = 1
                        if (key == "menu") { stockMenu.closeAll = 1 }
                        stockMenu.cue("cancel")
                    }
                    if (key == "confirm") {
                        if (stockMenu.shopCount > 0) {
                            ui.stackSel = selection
                            ui.stack = selection
                            stockMenu.enter(ui, "action", ui.actor0, 0, 0)
                            stockMenu.cue("choose")
                        }
                    }
                } else {
                    if (ui.mode == "action") {
                        stockMenu.nav(ui, key, 2)
                        if (key == "cancel") {
                            stockMenu.enter(ui, "list", ui.actor0, ui.stackSel, 0)
                            stockMenu.cue("cancel")
                        }
                        if (key == "menu") {
                            context.shop.close()
                            done = 1
                            stockMenu.closeAll = 1
                            stockMenu.cue("cancel")
                        }
                        if (key == "confirm") {
                            if (stockMenu.shopBuy[ui.stack] < 0 || stockMenu.shopSell[ui.stack] < 0) {
                                stockMenu.message = "That price cannot be traded"
                                stockMenu.cue("cancel")
                            } else {
                                if (selection == 1) {
                                    if (stockMenu.shopHeld(context, stockMenu.shopSources[ui.stack]) < 1) {
                                        stockMenu.message = "Nothing to sell"
                                        stockMenu.cue("cancel")
                                    } else {
                                        ui.action = "sell"
                                        ui.actionSel = 1
                                        stockMenu.enter(ui, "amount", ui.actor0, 0, 0)
                                        stockMenu.cue("choose")
                                    }
                                } else {
                                    ui.action = "buy"
                                    ui.actionSel = 0
                                    stockMenu.enter(ui, "amount", ui.actor0, 0, 0)
                                    stockMenu.cue("choose")
                                }
                            }
                        }
                    } else {
                        if (ui.mode == "amount") {
                            stockMenu.nav(ui, key, 9)
                            if (key == "cancel") {
                                stockMenu.enter(ui, "action", ui.actor0, ui.actionSel, 0)
                                stockMenu.cue("cancel")
                            }
                            if (key == "menu") {
                                context.shop.close()
                                done = 1
                                stockMenu.closeAll = 1
                                stockMenu.cue("cancel")
                            }
                            if (key == "confirm") {
                                amount = selection + 1
                                name = stockMenu.shopNames[ui.stack]
                                if (ui.action == "buy") {
                                    price = stockMenu.shopBuy[ui.stack]
                                    total = price * amount
                                    if (total > context.inventory.gold) {
                                        stockMenu.message = "Not enough gold"
                                        stockMenu.cue("cancel")
                                    } else {
                                        ui.amount = amount
                                        context.inventory.buyItem({ source: stockMenu.shopSources[ui.stack], amount: amount })
                                        stockMenu.message = "Bought " + name + " x " + amount
                                        stockMenu.enter(ui, "list", ui.actor0, ui.stackSel, 0)
                                        stockMenu.cue("choose")
                                    }
                                } else {
                                    available = stockMenu.shopHeld(context, stockMenu.shopSources[ui.stack])
                                    if (amount > available) {
                                        stockMenu.message = "Not enough to sell"
                                        stockMenu.cue("cancel")
                                    } else {
                                        ui.amount = amount
                                        context.inventory.sellItem({ entryId: stockMenu.shopEntryId, amount: amount })
                                        stockMenu.message = "Sold " + name + " x " + amount
                                        stockMenu.enter(ui, "list", ui.actor0, ui.stackSel, 0)
                                        stockMenu.cue("choose")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        stockMenu.close(parent)
        return 0
    },

    // ---- the save/load picker (dirsav) -----------------------------------------------------------------------
    // The cursor lives in the menu frame when one exists (and the opening screen's selection comes back when the
    // picker closes); a direct `dirsav()` call has no frame and keeps the cursor in `ui.sel`.
    pick: (context, title, allowNew) => {
        local(key) = ""
        local(done) = 0
        local(list) = savelist()
        local(index) = 0
        local(count) = 0
        local(selection) = 0
        local(name) = ""
        local(answer) = ""
        local(choice) = ""
        local(entrySel) = 0
        local(labels) = {}
        local(values) = {}
        local(dims) = {}
        stockMenu.saveNames = {}
        stockMenu.saveCount = 0
        for (index = 0; index < list.length; index = index + 1) {
            name = list[index].name
            // Host names are relative to the game identity; save/load add this directory and extension.
            if (len(name) > 10 && left(name, 6) == "saved/" && right(name, 4) == ".sav") {
                name = left(right(name, len(name) - 6), len(name) - 10)
                stockMenu.saveNames[stockMenu.saveCount] = name
                stockMenu.saveCount = stockMenu.saveCount + 1
            }
        }
        count = stockMenu.saveCount
        if (allowNew != 0) {
            count = count + 1
        }
        local(parent) = stockMenu.begin(context, "picker")
        local(ui) = stockMenu.newUi(context)
        if (ui.framed == 1) {
            entrySel = stockMenu.selection()
            stockMenu.setSel(ui, 0)
        }
        for (index = 0; index < stockMenu.saveCount; index = index + 1) {
            labels[index] = stockMenu.saveNames[index]
            values[index] = ""
            dims[index] = 0
        }
        if (allowNew != 0) {
            labels[stockMenu.saveCount] = "New save"
            values[stockMenu.saveCount] = ""
            dims[stockMenu.saveCount] = 0
        }
        while (done == 0) {
            if (ui.dirty == 1) {
                stockMenu.list(ui, title, labels, values, dims, count, "No saves")
                ui.dirty = 0
            }
            key = stockMenu.read(ui)
            if (key != "") {
                selection = stockMenu.getSel(ui)
                stockMenu.nav(ui, key, count)
                if (key == "cancel" || key == "menu") {
                    choice = "CANCEL"
                    done = 1
                    if (key == "menu") { stockMenu.closeAll = 1 }
                    stockMenu.cue("cancel")
                }
                if (key == "confirm") {
                    if (count > 0) {
                        if (selection < stockMenu.saveCount) {
                            choice = stockMenu.saveNames[selection]
                        } else {
                            answer = prompt("Save name")
                            if (answer == "") {
                                choice = "CANCEL"
                            } else {
                                choice = answer
                            }
                        }
                        done = 1
                        stockMenu.cue("choose")
                    }
                }
            }
        }
        if (ui.framed == 1) {
            stockMenu.choose(entrySel)
        }
        stockMenu.close(parent)
        return choice
    },
}

stockMenu.slotTokens[0] = "head"
stockMenu.slotTokens[1] = "neck"
stockMenu.slotTokens[2] = "right-hand"
stockMenu.slotTokens[3] = "left-hand"
stockMenu.slotTokens[4] = "body"
stockMenu.slotTokens[5] = "legs"
stockMenu.slotTokens[6] = "accessory-7"
stockMenu.slotTokens[7] = "accessory-8"
stockMenu.slotTokens[8] = "accessory-9"
stockMenu.slotTokens[9] = "accessory-10"
stockMenu.slotTokens[10] = "accessory-11"
stockMenu.slotTokens[11] = "accessory-12"
stockMenu.slotTokens[12] = "accessory-13"
stockMenu.slotTokens[13] = "accessory-14"
stockMenu.slotTokens[14] = "accessory-15"
stockMenu.slotTokens[15] = "accessory-16"

// ---- registration -------------------------------------------------------------------------------------------
// `internalmenu` stays the passthrough onto the facade; `dirsav` is the menu's own save/load picker, which is why it
// lives in this package rather than in the catalogue. The four providers replace the whole screen for their token.
registerplugin({
    name: "stock_menu",
    commands: {
        internalmenu: (menu, next) => {
            return next(menu)
        },
        dirsav: (title, allowNewFile, textColor, backColor, image, next) => {
            local(selected) = stockMenu.pick(stockMenu.context, title, allowNewFile)
            if (stockMenu.context == null) {
                stockMenu.closeAll = 0
            }
            return selected
        },
    },
    menuProviders: {
        main: (context) => {
            return stockMenu.mainScreen(context)
        },
        items: (context) => {
            return stockMenu.itemScreen(context)
        },
        equipment: (context) => {
            return stockMenu.equipmentScreen(context)
        },
        abilities: (context) => {
            return stockMenu.abilitiesScreen(context)
        },
        shop: (context) => {
            return stockMenu.shopScreen(context)
        },
    },
})
