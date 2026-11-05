// stock_battle's damage seam is deliberately RPGCode (BAT-5, EMIT-13). Each
// action calls one shared helper from the battle thread, so the cancelable
// dispatch parks that thread before any owner-backed stat write can clamp HP
// or SMP or publish a fallen transition.
localDamage = (request) => {
    local(event)
    local(source)
    local(target)
    local(pool)
    local(sourceId)
    source = request.source
    target = request.target
    pool = request.pool
    if (target == null) {
        return 0
    }
    sourceId = null
    if (source != null) {
        sourceId = source.id
    }
    event = target.emitcancelable("beforeDamage", {
        source: sourceId,
        target: target.id,
        damage: request.amount
    })
    if (event.canceled == 1) {
        return 0
    }
    return target.damage(event.detail.damage, sourceId, pool)
}

physical = (request) => {
    request.pool = "hp"
    return localDamage(request)
}

special = (request) => {
    request.pool = "hp"
    return localDamage(request)
}

drain = (request) => {
    request.pool = "smp"
    return localDamage(request)
}

attackall = (request) => {
    local(total)
    total = 0
    if (request.first != null) {
        if (request.first.hp > 0) {
            total = total + physical({ source: request.source, target: request.first, amount: request.amount })
        }
    }
    if (request.second != null) {
        if (request.second.hp > 0) {
            total = total + physical({ source: request.source, target: request.second, amount: request.amount })
        }
    }
    if (request.third != null) {
        if (request.third.hp > 0) {
            total = total + physical({ source: request.source, target: request.third, amount: request.amount })
        }
    }
    return total
}

drainall = (request) => {
    local(total)
    total = 0
    if (request.first != null) {
        if (request.first.hp > 0) {
            total = total + drain({ source: request.source, target: request.first, amount: request.amount })
        }
    }
    if (request.second != null) {
        if (request.second.hp > 0) {
            total = total + drain({ source: request.source, target: request.second, amount: request.amount })
        }
    }
    if (request.third != null) {
        if (request.third.hp > 0) {
            total = total + drain({ source: request.source, target: request.third, amount: request.amount })
        }
    }
    return total
}

// BAT-4: this hook spends the acting turn; the default enemy turn below reads
// `.ene` battle settings and uses the four built-in strategies or custom AI.
// A game or later stock-battle module can replace stockBattle.turn with
// `(party, index) => { ... }`. It runs on the loop's ONE thread; waits keep
// every fighter's charge parked, and the loop releases charge after return.
stockBattle = {
    enemyDataCache: {},
    specialDataCache: {},
    battleBackgroundDataCache: null,
  // Reusable setup-only entry points for custom fight programs. They share the
  // core setup path with Fight/FightEnemy but leave the caller's loop in charge.
    prepareRandom: (skill, background) => __battle_prepare_random(skill, background),
    prepareEnemies: (e1, e2, e3, e4, background) => __battle_prepare_enemies(e1, e2, e3, e4, background),
    defeatedIds: {},
    defeatedListeners: {},
    defeatedListenerCount: 0,
    livingCounts: { enemies: 0, players: 0 },
    fighterCounts: { enemies: 0, players: 0 },
    pendingOutcome: 0,
    coreOutcomePending: 0,
    decidedOutcome: 0,
    active: 0,
    runPending: 0,
  // Custom AI programs receive source/target actor IDs as strings. Resolve one
    resolveFighter: (handle) => {
        local(wanted)
        local(party) = 0
        local(index) = 0
        local(size)
        local(candidate)
        if (handle == null) {
            return null
        }
        wanted = handle
        if (handle == "source") {
            wanted = sourcehandle()
        }
        if (handle == "target") {
            wanted = targethandle()
        }
        if (wanted == null || wanted == 0) {
            return null
        }
        while (party < 2) {
            size = battle.partySize(party)
            index = 0
            while (index < size) {
                candidate = battle.fighter(party, index)
                if (candidate != null) {
                    if ("" + candidate.id == "" + wanted) {
                        return candidate
                    }
                }
                index = index + 1
            }
            party = party + 1
        }
        return null
    },
    enemyData: (fighter) => {
        local(key) = "" + fighter.id
        local(data)
        if (stockBattle.enemyDataCache == null) {
            stockBattle.enemyDataCache = {}
        }
        data = stockBattle.enemyDataCache[key]
        if (data == null) {
            data = battleenemydata(fighter)
            if (data != null) {
                stockBattle.enemyDataCache[key] = data
            }
        }
        return data
    },
    refreshPendingOutcome: () => {
        if (stockBattle.fighterCounts.players > 0 && stockBattle.livingCounts.players < 1) {
            stockBattle.pendingOutcome = 4
        } else {
            if (stockBattle.fighterCounts.enemies > 0 && stockBattle.livingCounts.enemies < 1) {
                stockBattle.pendingOutcome = 2
            } else {
                stockBattle.pendingOutcome = 0
            }
        }
    },
    recheckPendingOutcome: () => {
        local(party) = 0
        local(index)
        local(size)
        local(fighter)
        stockBattle.livingCounts = { enemies: 0, players: 0 }
        stockBattle.fighterCounts = { enemies: 0, players: 0 }
        while (party < 2) {
            size = battle.partySize(party)
            for (index = 0; index < size; index = index + 1) {
                fighter = battle.fighter(party, index)
                if (fighter != null) {
                    if (party == 0) {
                        stockBattle.fighterCounts.enemies = stockBattle.fighterCounts.enemies + 1
                        if (fighter.hp > 0) {
                            stockBattle.livingCounts.enemies = stockBattle.livingCounts.enemies + 1
                        }
                    } else {
                        stockBattle.fighterCounts.players = stockBattle.fighterCounts.players + 1
                        if (fighter.hp > 0) {
                            stockBattle.livingCounts.players = stockBattle.livingCounts.players + 1
                        }
                    }
                }
            }
            party = party + 1
        }
        stockBattle.refreshPendingOutcome()
    },
    watchPlayer: (fighter) => {
        local(listener)
        stockBattle.fighterCounts.players = stockBattle.fighterCounts.players + 1
        if (fighter.hp > 0) {
            stockBattle.livingCounts.players = stockBattle.livingCounts.players + 1
        }
        listener = (event) => {
            stockBattle.livingCounts.players = stockBattle.livingCounts.players - 1
            stockBattle.refreshPendingOutcome()
        }
        fighter.on("fallen", listener)
        stockBattle.defeatedListeners[stockBattle.defeatedListenerCount] = {
            fighter: fighter, listener: listener
        }
        stockBattle.defeatedListenerCount = stockBattle.defeatedListenerCount + 1
    },
    watchEnemy: (fighter) => {
        local(id) = "" + fighter.id
        local(listener)
        stockBattle.fighterCounts.enemies = stockBattle.fighterCounts.enemies + 1
        if (fighter.hp > 0) {
            stockBattle.livingCounts.enemies = stockBattle.livingCounts.enemies + 1
        }
        listener = (event) => {
            stockBattle.livingCounts.enemies = stockBattle.livingCounts.enemies - 1
            stockBattle.refreshPendingOutcome()
            if (stockBattle.defeatedIds[id] == null) {
                stockBattle.defeatedIds[id] = 1
                emit(fighter, "defeated", {
                    cause: event.detail.cause,
                    source: event.detail.source
                })
                game.emit("stock_battle.defeated", {
                    cause: event.detail.cause,
                    source: event.detail.source
                })
            }
        }
        fighter.on("fallen", listener)
        stockBattle.defeatedListeners[stockBattle.defeatedListenerCount] = {
            fighter: fighter, listener: listener
        }
        stockBattle.defeatedListenerCount = stockBattle.defeatedListenerCount + 1
    },
  // A script outside the loop may record the battle's outcome (`battle.finish`). Note it, so the loop, and any menu
  // waiting on the player, end instead of carrying on.
    noteRecordedOutcome: () => {
        if (battle.outcome != null) {
            stockBattle.coreOutcomePending = 1
        }
        return stockBattle.coreOutcomePending
    },
    clearDefeatedListeners: () => {
        local(index) = 0
        local(record)
        while (index < stockBattle.defeatedListenerCount) {
            record = stockBattle.defeatedListeners[index]
            record.fighter.off("fallen", record.listener)
            index = index + 1
        }
        stockBattle.defeatedIds = {}
        stockBattle.defeatedListeners = {}
        stockBattle.defeatedListenerCount = 0
        stockBattle.livingCounts = { enemies: 0, players: 0 }
        stockBattle.fighterCounts = { enemies: 0, players: 0 }
        stockBattle.pendingOutcome = 0
        stockBattle.decidedOutcome = 0
        stockBattle.coreOutcomePending = 0
    },
    canRun: () => {
        local(size)
        local(index) = 0
        local(fighter)
        local(data)
        if (battle.canRun == 0) {
            return 0
        }
        size = battle.partySize(0)
        while (index < size) {
            fighter = battle.fighter(0, index)
            if (fighter != null) {
                data = stockBattle.enemyData(fighter)
                if (data == null || data.canrun == 0) {
                    return 0
                }
            }
            index = index + 1
        }
        return 1
    },
    playCantDoSound: () => {
        local(data)
        if (stockBattle.battleBackgroundDataCache == null) {
            stockBattle.battleBackgroundDataCache = battlebackgrounddata()
        }
        data = stockBattle.battleBackgroundDataCache
        if (data != null && data.cantsound != "") {
            mediaplay(data.cantsound, { track: "ui", loop: 0 })
        }
    },
    run: () => {
        if (stockBattle.canRun() == 0) {
            stockBattle.preserveCharge = 1
            stockBattle.playCantDoSound()
            return 0
        }
        if (random(5) <= 2) {
            stockBattle.runPending = 1
            mwin("Escaped.")
            return 1
        }
        mwin("Could not escape.")
        return 0
    },
    living: (party) => {
        local(result) = { count: 0, fighters: {} }
        local(size) = battle.partySize(party)
        local(index) = 0
        local(candidate)
        while (index < size) {
            candidate = battle.fighter(party, index)
            if (candidate != null) {
                if (candidate.hp > 0) {
                    result.fighters[result.count] = candidate
                    result.count = result.count + 1
                }
            }
            index = index + 1
        }
        return result
    },
    randomLiving: (living) => {
        if (living.count < 1) {
            return null
        }
        return living.fighters[random(living.count) - 1]
    },
  // Strictly-smaller replacement preserves the earlier party position on ties.
    weakest: (living) => {
        local(index) = 1
        local(candidate)
        local(result)
        if (living.count < 1) {
            return null
        }
        result = living.fighters[0]
        while (index < living.count) {
            candidate = living.fighters[index]
            if (candidate.hp < result.hp) {
                result = candidate
            }
            index = index + 1
        }
        return result
    },
    availableSpecials: (fighter, data) => {
        local(result) = { count: 0, moves: {} }
        local(index) = 0
        local(file)
        local(move)
        while (index < data.specialcount) {
            file = data.specialmoves[index]
            if (file != "") {
                move = stockBattle.specialDataCache[file]
                if (move == null) {
                    move = battlemovedata(file)
                    if (move != null) {
                        stockBattle.specialDataCache[file] = move
                    }
                }
                if (move != null) {
                    if (move.smp <= fighter.smp) {
                        result.moves[result.count] = { file: file, data: move }
                        result.count = result.count + 1
                    }
                }
            }
            index = index + 1
        }
        return result
    },
    performAi: (fighter, level) => {
        local(players) = stockBattle.living(1)
        local(trySpecial) = 0
        local(data)
        local(available)
        local(choice)
        local(targets)
        local(target)
        if (fighter == null) {
            return 0
        }
        if (fighter.hp < 1) {
            return 0
        }
        if (players.count < 1) {
            return 0
        }
        if (level < 0 || level > 3) {
            ai(level)
            return 0
        }
        if (level == 1 || level == 3) {
            trySpecial = 1
        }
        if (level == 0 || level == 2) {
            if (random(2) == 2) {
                trySpecial = 1
            }
        }
        if (trySpecial != 0) {
            data = stockBattle.enemyData(fighter)
            if (data != null) {
                available = stockBattle.availableSpecials(fighter, data)
                if (available.count > 0) {
                    choice = available.moves[random(available.count) - 1]
                    if (choice.data.fp < 0) {
                        targets = stockBattle.living(0)
                        if (level < 2) {
                            target = stockBattle.randomLiving(targets)
                        } else {
                            target = stockBattle.weakest(targets)
                        }
                    } else {
                        if (level < 2) {
                            target = stockBattle.randomLiving(players)
                        } else {
                            target = stockBattle.weakest(players)
                        }
                    }
                    if (target != null) {
                        return stockBattle.special(fighter, target, choice.file)
                    }
                }
            }
        }
        if (level < 2) {
            target = stockBattle.randomLiving(players)
        } else {
            target = stockBattle.weakest(players)
        }
        if (target == null) {
            return 0
        }
        return stockBattle.attack(fighter, target)
    },
    turn: (party, index) => {
        local(fighter)
        local(players)
        local(data)
        local(target)
        if (party != 0) {
            return 0
        }
        fighter = battle.fighter(party, index)
        if (fighter == null) {
            return 0
        }
        players = stockBattle.living(1)
        if (players.count < 1) {
            return 0
        }
        data = stockBattle.enemyData(fighter)
        if (data == null) {
            return 0
        }
    // BAT-6: a status that takes a fighter to 0 HP does not stop the turn, so a
    // fallen enemy with a custom AI program still runs it. Its attacks, moves
    // and items are refused by their source guards below, and performAi refuses
    // a fallen fighter for the built-in levels.
        if (data.customai != 0) {
            target = stockBattle.randomLiving(players)
            if (target != null) {
                executeprogram(data.aiprogram, { source: "" + fighter.id, target: "" + target.id })
            }
            return 0
        }
        return stockBattle.performAi(fighter, data.ailevel)
    },
  // Headless games have no battle screen. Positions and drawing belong to
  // ticket 7.11's default UI, which replaces this hook. Returning here does
  // not claim that a drawing request was made or an animation was displayed.
    animate: (file, fighter) => { return 0 },
    attack: (source, target) => {
        if (source == null) {
            return 0
        }
        return stockBattle.attackAmount(source, target, source.fp, "hp")
    },
  // E-74: only positive supplied amounts consume randomness. The offensive
  // critical draw precedes the defensive one, which a successful first draw
  // skips. A missing side (-1) consumes no draw, including for limit zero.
    attackAmount: (source, target, amount, pool) => {
        local(hit)
        if (source == null) {
            return 0
        }
        if (target == null) {
            return 0
        }
        if (source.hp < 1) {
            return 0
        }
    // SEM-3: reading a variable or member by name narrows a number to signed
    // 32 bits, so the luck product goes through integerMulDiv, which keeps the
    // product exact and drops the fraction toward zero before DP is subtracted.
    // Supplied amounts must keep (amount * (100 + p) / 100) within signed 32
    // bits; real stats are 32-bit on disk and 1.09 times a stat that large is
    // not a game value.
        hit = { amount: amount, critical: 0 }
        if (hit.amount > 0) {
            hit.amount = integermuldiv(hit.amount, 100 + random(20) - 11, 100)
            if (source.criticalBy >= 0) {
                hit.critical = random(source.criticalBy + 1) == 1
            }
            if (hit.critical == 0) {
                if (target.criticalOn >= 0) {
                    hit.critical = random(target.criticalOn + 1) == 1
                }
            }
            if (hit.critical == 0) {
                hit.amount = hit.amount - target.dp
            }
        }
        if (hit.amount < 1) {
            hit.amount = 1
        }
        if (pool == "smp") {
            return drain({ source: source, target: target, amount: hit.amount })
        }
        return physical({ source: source, target: target, amount: hit.amount })
    },
  // BAT-5 special move. No luck, critical, DP or floor: FP and target-SMP
  // come off the target, the cost off the user, each clamped by the actor
  // owner. Returns the actual amounts removed (a heal is negative) for the UI.
  // The user's SMP must cover the cost, or `battle.unaffordable` is reported
  // and nothing changes and no random number is drawn.
    special: (source, target, file) => {
        local(move)
        local(result)
        result = { hp: 0, smp: 0, cost: 0 }
        if (source == null) {
            return result
        }
        if (target == null) {
            return result
        }
        if (source.hp < 1) {
            return result
        }
        move = stockBattle.specialDataCache[file]
        if (move == null) {
            move = battlemovedata(file)
            if (move != null) {
                stockBattle.specialDataCache[file] = move
            }
        }
        if (move == null) {
            return result
        }
        if (source.smp < move.smp) {
            battleunaffordable()
            return result
        }
        if (move.fp != 0) {
            result.hp = special({ source: source, target: target, amount: move.fp })
        }
        if (move.targetsmp != 0) {
            result.smp = drain({ source: source, target: target, amount: move.targetsmp })
        }
        if (move.smp != 0) {
            result.cost = source.smp
            source.smp = source.smp - move.smp
            result.cost = result.cost - source.smp
        }
        stockBattle.presentation(fighteranimationfile(source, "special move"), source)
        stockBattle.presentation(move.animation, target)
        if (move.program != "") {
            executeprogram(move.program, { source: "" + source.id, target: "" + target.id })
        }
        if (move.statuseffect != "") {
            applystatus(target, move.statuseffect)
        }
        return result
    },
  // BAT-5 item. The item's battle HP and SMP are added to the target (clamped
  // 0..max by the actor owner), then exactly one consume effect goes to the
  // inventory port, naming the stack (`handle`, null when the caller knows only
  // the file), then the item's animation and program. The item list is never
  // read or edited here.
    item: (source, target, file, handle) => {
        local(data)
        local(result)
        result = { hp: 0, smp: 0 }
        if (source == null) {
            return result
        }
        if (target == null) {
            return result
        }
        if (source.hp < 1) {
            return result
        }
        data = battleitemdata(file)
        if (data == null) {
            return result
        }
        if (data.hp != 0) {
            result.hp = special({ source: source, target: target, amount: 0 - data.hp })
        }
        if (data.smp != 0) {
            result.smp = drain({ source: source, target: target, amount: 0 - data.smp })
        }
        battleconsume(file, target, data.hp, data.smp, handle)
        stockBattle.presentation(data.animation, target)
        if (data.program != "") {
            executeprogram(data.program, { source: "" + source.id, target: "" + target.id })
        }
        return result
    },
  // The empty-name guard keeps the hook free of no-animation calls.
    presentation: (file, fighter) => {
        if (file != "") {
            if (file != 0) {
                stockBattle.animate(file, fighter)
            }
        }
        return 0
    },
}

// The owner stores a live battle's outcome as null, distinct from code zero.
battleDecided = () => {
    stockBattle.noteRecordedOutcome()
    if (stockBattle.pendingOutcome != 0) {
        stockBattle.recheckPendingOutcome()
    }
    if (stockBattle.pendingOutcome == 4 ||
    (stockBattle.coreOutcomePending != 0 && battle.outcome == 4)) {
        stockBattle.decidedOutcome = 4
        return 1
    }
    if (stockBattle.pendingOutcome == 2) {
        stockBattle.decidedOutcome = 2
        return 1
    }
    if (stockBattle.coreOutcomePending != 0) {
        stockBattle.decidedOutcome = battle.outcome
        return 1
    }
    if (stockBattle.runPending != 0) {
        stockBattle.decidedOutcome = 0
        return 1
    }
    return 0
}
// Status identity and counters belong to the actor; this package loads the
// cached .ste data, interprets its rate flags, and ticks effects at turns.
function battleStatusBefore(leftText, rightText) {
    local(leftKey) = ucase(leftText)
    local(rightKey) = ucase(rightText)
    local(leftLength) = len(leftKey)
    local(rightLength) = len(rightKey)
    local(index) = 1
    local(leftCode)
    local(rightCode)
    while (index <= leftLength && index <= rightLength) {
        leftCode = asc(charat(leftKey, index))
        rightCode = asc(charat(rightKey, index))
        if (leftCode < rightCode) {
            return 1
        }
        if (leftCode > rightCode) {
            return 0
        }
        index = index + 1
    }
    return leftLength < rightLength
}

function battleStatusRate(fighter, cache) {
    local(file)
    local(index) = 0
    local(orderIndex)
    local(sortIndex)
    local(data)
    local(key)
    cache.signature = statussignature(fighter)
    cache.rate = 3
    cache.disabled = 0
    cache.order = {}
    file = getstatus(fighter, index)
    while (file != "") {
        key = ucase(file)
        data = cache.files[key]
        if (data == null) {
            data = statusdata(file)
            if (data == null) {
                data = {
                    rounds: 0, speed: 0, slow: 0, disable: 0,
                    hp: 0, hpamount: 0, smp: 0, smpamount: 0,
                    runprogram: 0, program: ""
                }
            }
            cache.files[key] = data
        }
        cache.rate = cache.rate + 2 * data.speed - 2 * data.slow
        cache.disabled = cache.disabled + data.disable
        cache.order[index + 1] = file
        index = index + 1
        file = getstatus(fighter, index)
    }
    cache.statusCount = index
    for (orderIndex = 2; orderIndex <= cache.statusCount; orderIndex = orderIndex + 1) {
        file = cache.order[orderIndex]
        sortIndex = orderIndex - 1
        while (sortIndex >= 1 && battleStatusBefore(file, cache.order[sortIndex])) {
            cache.order[sortIndex + 1] = cache.order[sortIndex]
            sortIndex = sortIndex - 1
        }
        cache.order[sortIndex + 1] = file
    }
  // Keep only ordered effects in the turn hot path; all active statuses still age below.
    if (cache.statusCount > 0) {
        cache.effectOrder = {}
        cache.effectCount = 0
        for (orderIndex = 1; orderIndex <= cache.statusCount; orderIndex = orderIndex + 1) {
            file = cache.order[orderIndex]
            data = cache.files[ucase(file)]
            if ((data.hp != 0 && data.hpamount != 0) ||
            (data.smp != 0 && data.smpamount != 0) || data.runprogram != 0) {
                cache.effectCount = cache.effectCount + 1
                cache.effectOrder[cache.effectCount] = { file: file, data: data }
            }
        }
    }
    return cache.rate
}

function battleStatusTurn(fighter, cache) {
    local(position) = 1
    local(effect)
    local(file)
    local(data)
    while (position <= cache.effectCount) {
        effect = cache.effectOrder[position]
        file = effect.file
        data = effect.data
        if (data.hp != 0 && data.hpamount != 0) {
      __battle_status_delta(fighter, "hp", data.hpamount)
        }
        if (data.smp != 0 && data.smpamount != 0) {
      __battle_status_delta(fighter, "smp", data.smpamount)
        }
        if (data.runprogram != 0) {
            executeprogram(data.program, { source: "" + fighter.id, target: "" + fighter.id, status: file })
        }
        position = position + 1
    }
    if (cache.statusCount > 0) {
    __battle_status_advance(fighter, 1)
    }
}

// The start command supplies the battle section. This package owns charge,
// status rounds/effects, and the action thread's turn seam.
// BAT-4 idle-pass ceilings are 476/626/701 steps for six/eight/nine fighters;
// measured passes use 440/576/644 with no statuses or one cached inert status
// per fighter, within STEP_BUDGET=1000. Status changes and turns can preempt;
// BAT-4 resumes the saved pass.
function battle() {
    local(party)
    local(index)
    local(size)
    local(threshold)
    local(fighter)
    local(charge)
    local(cache)
    local(position)
    local(count) = 0
    local(readySound) = ""
    local(fighters) = {}
    local(done) = 0
    stockBattle.active = 1
    stockBattle.clearDefeatedListeners()
    stockBattle.enemyDataCache = {}
    stockBattle.specialDataCache = {}
  // BAT-10 cue inventory: the fight background's cue files are read once, here,
  // so a pass never parks on a file request. An empty field is silent.
    stockBattle.battleBackgroundDataCache = battlebackgrounddata()
    if (stockBattle.battleBackgroundDataCache != null) {
        readySound = stockBattle.battleBackgroundDataCache.readysound
    }
    stockBattle.runPending = 0
    stockBattle.preserveCharge = 0
  // BAT-2 fixes the battle's fighter lists. Capture their ordered references
  // and constants once, not mutable HP or status data. Restore keeps these
  // dictionaries and actor handles; it does not rebuild or reseed the battle.
    for (party = 0; party < 2; party = party + 1) {
        threshold = party == 0 ? 123 : 75
        size = battle.partySize(party)
        for (index = 0; index < size; index = index + 1) {
            battle.setCharge(party, index, random(threshold) - 1)
            fighter = battle.fighter(party, index)
            if (fighter != null) {
                fighters[count] = {
                    party: party, index: index, threshold: threshold, fighter: fighter, files: {}, ready: 0
                }
                count = count + 1
            }
        }
    }
  // Resolve current status assets only after every initial seeded draw. Empty
  // status sets need no status-rule load; their stock cache is the base rate.
    for (position = 0; position < count; position = position + 1) {
        cache = fighters[position]
        cache.signature = statussignature(cache.fighter)
        if (cache.signature != "{}") {
            battleStatusRate(cache.fighter, cache)
        } else {
            cache.rate = 3
            cache.disabled = 0
            cache.statusCount = 0
            cache.effectCount = 0
        }
    }
    threadsleep(getthreadid(), 1/60)
  // Capture current actor state and install both parties' watchers before any
  // stock turn can run.
    for (position = 0; position < count; position = position + 1) {
        cache = fighters[position]
        if (cache.party == 0) {
            stockBattle.watchEnemy(cache.fighter)
        } else {
            stockBattle.watchPlayer(cache.fighter)
        }
    }
    stockBattle.refreshPendingOutcome()
    stockBattleUi.begin()
    while (done == 0) {
        while (stockBattle.pendingOutcome == 0 &&
        stockBattle.coreOutcomePending == 0 &&
        stockBattle.runPending == 0 &&
        battle.outcome == null) {
            for (position = 0; position < count; position = position + 1) {
                cache = fighters[position]
                fighter = cache.fighter
                if (fighter.hp > 0) {
                    if (statussignature(fighter) != cache.signature) {
                        battleStatusRate(fighter, cache)
                    }
                    charge = battle.charge(cache.party, cache.index)
                    if (cache.disabled > 0) {
                        if (charge >= cache.threshold) {
                            battle.setCharge(cache.party, cache.index, cache.threshold - 1)
                            cache.ready = 0
                        }
                    } else {
                        if (charge >= cache.threshold) {
                            if (cache.statusCount > 0) {
                                battleStatusTurn(fighter, cache)
                            }
              // A successful run ends at the next pass boundary: later fighters still tick statuses but do not take turns.
                            if (stockBattle.runPending == 0) {
                                if (cache.ready == 0) {
                                    cache.ready = 1
                                    if (readySound != "") {
                                        mediaplay(readySound, { track: "ui", loop: 0 })
                                    }
                                }
                                if (cache.party == 1) {
                                    stockBattle.preserveCharge = 0
                                    stockBattle.turn(cache.party, cache.index)
                                    if (stockBattle.preserveCharge == 0) {
                                        battle.releaseCharge(cache.party, cache.index)
                                        cache.ready = 0
                                        if (stockBattleUi.on != 0) {
                                            stockBattleUi.target = stockBattleUi.screen
                                            stockBattleUi.drawChargeBar(cache.index, battle.fighter(cache.party, cache.index))
                                        }
                                    }
                                } else {
                                    stockBattle.turn(cache.party, cache.index)
                                    battle.releaseCharge(cache.party, cache.index)
                                    cache.ready = 0
                                }
                            }
                        } else {
                            battle.addCharge(cache.party, cache.index, cache.rate)
                        }
                    }
                }
            }
      // Even an idle pass must consume one simulated tick. The outcome is checked
      // only between passes: later fighters still finish the pass that decided it.
            stockBattleUi.pass()
            threadsleep(getthreadid(), 1/60)
        }
        if (battleDecided() != 0) {
      __battle_apply_outcome(stockBattle.decidedOutcome)
            done = 1
        }
    }
    stockBattleUi.finish()
    stockBattle.active = 0
    stockBattle.clearDefeatedListeners()
}

// ---- The default battle screen (BAT-11, entry 7.11) -------------------------------------------------------------
// Everything below only reads the battle and the actors and draws with the ruled primitives: `fillrect`, `drawrect`,
// `pixelText`, `drawcanvas` and `bitmap` (the .bkg picture), into the render-now canvas, and it shows each fighter's
// stance with `pinnedanimation`, which the engine keeps animating by itself (BAT-11 item 4). It owns no rule: the
// only writes are the package's own `stockBattle.attack`, `special`, `item` and `run` calls that the player's choice
// makes, and the key queue it reads. The screen is on only when the host has a screen surface; a headless run keeps
// the old behaviour (a player's turn is skipped).
stockBattleUi = {
    highlight: { r: 255, g: 224, b: 64 },
    on: 0,
    w: 0,
    h: 0,
    picture: "",
    screen: 0,
    buffer: 0,
    overlayScratch: 0,
    background: {},
    backgroundCount: 0,
    hudCopy: 0,
    hudOn: 0,
    target: 0,
    layout: {},
    files: {},
    controlSig: "",
    nextControlSig: "",
    staticSig: "",
    chars: {},
    itemData: {},
    signature: "",
    roster: {},
    rosterParty: {},
    rosterIndex: {},
    spriteKey: {},
    spriteId: {},
    spriteHidden: {},
    rosterCount: 0,
    cachedStats: {},
    changedSlot: {},
    changedName: {},
    changedCount: 0,
    statsRevision: 0,
    scan: 0,
    barScan: 0,
    bars: {},
    playerCount: 0,
    chargeInner: 0,
    mode: "idle",
    cursor: 0,
    top: 0,
    message: "",
    numbers: {},
    numberCount: 0,
    acting: null,
    actingStance: "",
    menuIndex: 0,
    pendingKind: "",
    pendingEntry: null,
    specials: {},
    specialCount: 0,
    items: {},
    itemcount: 0,
    specialsEmpty: 0,
    itemsEmpty: 0,
    targets: {},
    targetCount: 0,
    targetCursor: 0,
    targetParty: 0,
    labelParty: -1,
    sceneBaseValid: 0,
    sceneBaseSig: "",
    targetLabels: {},
    targetFullLabels: {},
    listKind: "",
    list: {},
    listCount: 0,
    listCursor: 0,
    listTop: 0,
    frames: 0,
    baseTurn: null,
  // One table of layout values so the owner can review the screen as numbers. Everything is derived from the screen
  // size: enemies stay in the upper left, players in the upper right, and the status panel on the bottom edge.
    makeLayout: (w, h) => {
        local(layout) = {}
        layout.w = w
        layout.h = h
        layout.panelH = 132
        layout.panelY = h - 132
        layout.messageY = h - 132 - 24
        layout.messageH = 20
    // Visual reference layout: prominent unobstructed upper battlefield with enemies left, player sprites right.
        layout.enemyX = 40
        layout.enemyY = 40
        layout.enemyDX = 120
        layout.enemyDY = 112
        layout.sprite = 64
        layout.playerX = w - 40 - 64
        layout.playerY = 24
    // Party pictures: three down the right edge and the fourth and fifth in a second column to their left, so all five
    // 64-pixel pictures sit clear of each other (pitch 76 >= 64) without overlapping the enemies' grid.
        layout.playerDY = 76
        layout.playerDX = 76
    // Adjacent bottom panels: command panel on the left (x = 8..152), party status panel on the right (x = 160..w-8).
        layout.cmdX = 8
        layout.cmdW = 144
        layout.partyX = 160
        layout.partyW = w - 168
        layout.rowX = 172
        layout.rowY = h - 132 + 8
    // Up to five party members (E-85 maximum 5) fit cleanly inside the 132px panel: 5 * 24 = 120px + 8 = 128px
        layout.rowDY = 24
        layout.hpX = 276
    // Party names are drawn 16 pixels per letter and must stop before the HP bar (4 pixels clear of it).
        layout.nameChars = integermuldiv(276 - 172 - 4, 1, 16)
        layout.hpW = 112
        layout.smpX = 396
        layout.smpW = 96
        layout.chargeX = 500
        layout.chargeW = 112
        layout.barH = 14
        layout.menuRowH = 24
        layout.listRows = 8
        layout.listCapacity = 16
        layout.listRowH = 30
        layout.numberTicks = 36
        return layout
    },
  // Menu cues come from the .bkg: cursor move, choose, and "cannot" (the existing cantDoSound).
    cue: (kind) => {
        local(data)
        local(file) = ""
        data = stockBattle.battleBackgroundDataCache
        if (data == null) {
            return 0
        }
        if (kind == "select") {
            file = data.selectsound
        }
        if (kind == "choose") {
            file = data.choosesound
        }
        if (kind == "cant") {
            file = data.cantsound
        }
        if (file != "") {
            mediaplay(file, { track: "ui", loop: 0 })
        }
        return 0
    },
    begin: () => {
        local(w)
        local(h)
        local(screen)
        local(party)
        local(index)
        local(size)
        local(fighter)
        local(source)
        local(stance)
        local(stances) = {}
        local(slot)
        local(key)
        local(file)
        local(scratch)
        stances[0] = "rest"
        stances[1] = "die"
        stances[2] = "fight"
        stances[3] = "special move"
        stockBattleUi.on = 0
        screen = battlescreensize()
        if (screen == null) {
            return 0
        }
        w = screen.width
        h = screen.height
        if (w < 1 || h < 1) {
            return 0
        }
        stockBattleUi.w = w
        stockBattleUi.h = h
        stockBattleUi.layout = stockBattleUi.makeLayout(w, h)
        stockBattleUi.files = {}
        stockBattleUi.staticSig = ""
        stockBattleUi.controlSig = ""
        stockBattleUi.nextControlSig = ""
        stockBattleUi.sceneBaseValid = 0
        stockBattleUi.sceneBaseSig = ""
        stockBattleUi.chars = {}
        stockBattleUi.itemData = {}
        stockBattleUi.signature = ""
        stockBattleUi.roster = {}
        stockBattleUi.rosterParty = {}
        stockBattleUi.rosterIndex = {}
        stockBattleUi.spriteKey = {}
        stockBattleUi.spriteId = {}
        stockBattleUi.spriteHidden = {}
        stockBattleUi.rosterCount = 0
        stockBattleUi.cachedStats = {}
        stockBattleUi.changedSlot = {}
        stockBattleUi.changedName = {}
        stockBattleUi.changedCount = 0
        stockBattleUi.statsRevision = 0
        stockBattleUi.scan = 0
        stockBattleUi.barScan = 0
        stockBattleUi.bars = {}
        stockBattleUi.playerCount = battle.partySize(1)
        stockBattleUi.chargeInner = stockBattleUi.layout.chargeW - 2
        stockBattleUi.mode = "idle"
        stockBattleUi.message = ""
        stockBattleUi.numbers = {}
        stockBattleUi.numberCount = 0
        stockBattleUi.acting = null
        stockBattleUi.targets = {}
        stockBattleUi.targetCount = 0
        stockBattleUi.list = {}
        stockBattleUi.listCount = 0
        if (stockBattle.battleBackgroundDataCache == null) {
            stockBattle.battleBackgroundDataCache = battlebackgrounddata()
        }
        for (party = 0; party < 2; party = party + 1) {
            size = battle.partySize(party)
            for (index = 0; index < size; index = index + 1) {
                fighter = battle.fighter(party, index)
                if (fighter != null) {
                    stockBattleUi.roster[stockBattleUi.rosterCount] = fighter
                    stockBattleUi.rosterParty[stockBattleUi.rosterCount] = party
                    stockBattleUi.rosterIndex[stockBattleUi.rosterCount] = index
                    stockBattleUi.spriteKey[stockBattleUi.rosterCount] = ""
                    stockBattleUi.spriteId[stockBattleUi.rosterCount] = 0
                    stockBattleUi.spriteHidden[stockBattleUi.rosterCount] = 0
                    stockBattleUi.cachedStats[stockBattleUi.rosterCount] = { name: fighter.name, hp: fighter.hp, maxhp: fighter.maxhp, smp: fighter.smp, maxsmp: fighter.maxsmp }
                    stockBattleUi.rosterCount = stockBattleUi.rosterCount + 1
                    source = "" + fighter.source
                    for (slot = 0; slot < 4; slot = slot + 1) {
                        stance = stances[slot]
                        key = source + "|" + stance
                        if (stockBattleUi.files[key] == null) {
                            file = fighteranimationfile(fighter, stance)
                            if (file == null) {
                                file = ""
                            }
                            stockBattleUi.files[key] = file
                        }
                    }
                    if (party == 1) {
                        stockBattleUi.chars["" + fighter.id] = battlecharacterdata(fighter)
                    }
                }
            }
        }
    // The background picture is fetched and decoded by the host, and a first use only queues the fetch. Draw it once
    // into a one-pixel scratch canvas and wait a few ticks, so that by the first real frame it is cached and every
    // later `bitmap` lands in the order the screen draws it. Fighter pictures are requested and loaded by the
    // engine itself when their animations start, below.
        scratch = createcanvas(1, 1)
    // `bitmap` decodes PNG, JPEG, BMP, GIF and tile bitmaps (.tbm, whose cells the engine composes from their tiles),
    // so every picture a background can name is drawn.
        stockBattleUi.picture = ""
        if (stockBattle.battleBackgroundDataCache != null) {
            stockBattleUi.picture = stockBattle.battleBackgroundDataCache.image
        }
        if (stockBattleUi.picture != "") {
            bitmap(stockBattleUi.picture, scratch)
        }
        stockBattleUi.syncSprites(0, stockBattleUi.rosterCount)
    // Nothing is drawn yet: the canvases below do not exist until the wait is over.
        threadsleep(getthreadid(), 4/60)
        killcanvas(scratch)
    // The overlay is the game's, which may already show its own HUD on it: keep its on/off flag and its pixels so
    // `finish` can put them back (BAT-11 item 10).
        stockBattleUi.hudOn = rendernowenabled()
        stockBattleUi.hudCopy = 0
        if (cnvrendernow != 0) {
            stockBattleUi.hudCopy = createcanvas(w, h)
            drawcanvas(cnvrendernow, 0, 0, w, h, stockBattleUi.hudCopy)
        }
        rendernow(1)
        stockBattleUi.screen = cnvrendernow
        stockBattleUi.target = stockBattleUi.screen
        stockBattleUi.buffer = createcanvas(w, h)
        stockBattleUi.background = {}
        stockBattleUi.backgroundCount = 0
        stockBattleUi.overlayScratch = createcanvas(w, h)
        stockBattleUi.on = 1
        stockBattleUi.refresh()
        return 1
    },
    finish: () => {
        local(index)
        if (stockBattleUi.on == 0) {
            return 0
        }
        stockBattleUi.on = 0
        stockBattleUi.endSprites()
        killcanvas(stockBattleUi.buffer)
        stockBattleUi.buffer = 0
        killcanvas(stockBattleUi.overlayScratch)
        for (index = 0; index < stockBattleUi.backgroundCount; index = index + 1) {
            killcanvas(stockBattleUi.background[index])
        }
        stockBattleUi.background = {}
        stockBattleUi.backgroundCount = 0
        stockBattleUi.overlayScratch = 0
    // Hand the overlay back as it was: the game's pixels (clear when it had none) and its on/off flag. The canvas
    // itself stays, as the reserved canvas always does.
        clear(stockBattleUi.screen)
        if (stockBattleUi.hudCopy != 0) {
            drawcanvas(stockBattleUi.hudCopy, 0, 0, stockBattleUi.w, stockBattleUi.h, stockBattleUi.screen)
            killcanvas(stockBattleUi.hudCopy)
            stockBattleUi.hudCopy = 0
        }
        if (stockBattleUi.hudOn == 0) {
            rendernow(0)
        }
        stockBattleUi.screen = 0
        stockBattleUi.target = 0
        return 0
    },
  // The idle battle loop calls this once per pass, inside the pass's step budget (BAT-4), so it looks at two fighters
  // and one charge bar per pass: with nine fighters every one is compared within five passes, and a changed fighter
  // is repainted as a small patch (patchFighter) rather than redrawn in full. A bar whose charge only grew paints
  // just its new columns, so its cache holds the whole percent last drawn (the width is a pure function of it).
    pass: () => {
        if (stockBattleUi.on == 0) {
            return 0
        }
        if (stockBattleUi.mode == "target") {
            return 0
        }
        local(ui) = stockBattleUi
        local(roster) = ui.roster
        local(cached) = ui.cachedStats
        local(count) = ui.rosterCount
        local(position) = ui.scan
        local(last) = position + 2
        local(slot)
        local(fighter)
        local(previous)
        local(percent)
        local(bar)
        local(from)
        local(to)
        local(y)
        for (position = position; position < last; position = position + 1) {
            slot = position % count
            fighter = roster[slot]
            previous = cached[slot]
            if (fighter.hp != previous.hp || fighter.smp != previous.smp || fighter.maxhp != previous.maxhp || fighter.maxsmp != previous.maxsmp || fighter.name != previous.name) {
                cached[slot] = { name: fighter.name, hp: fighter.hp, maxhp: fighter.maxhp, smp: fighter.smp, maxsmp: fighter.maxsmp }
                ui.patchFighter(slot)
            }
        }
        ui.scan = position % count
        if (ui.playerCount > 0) {
            bar = ui.barScan
            percent = battle.chargePercent(1, bar)
            previous = ui.bars[bar]
            if (previous != percent) {
                if (percent > previous) {
                    from = (previous * ui.chargeInner - (previous * ui.chargeInner) % 100) / 100
                    to = (percent * ui.chargeInner - (percent * ui.chargeInner) % 100) / 100
                    if (to > from) {
                        y = ui.layout.rowY + bar * ui.layout.rowDY
                        colorrgb(240, 200, 40)
                        fillrect(ui.layout.chargeX + 1 + from, y + 1, ui.layout.chargeX + to, y + ui.layout.barH - 2, ui.target)
                    }
                    ui.bars[bar] = percent
                } else {
                    ui.drawChargeBar(bar, null)
                }
            }
            ui.barScan = (bar + 1) % ui.playerCount
        }
        return 0
    },
    box: (x1, y1, x2, y2, r, g, b) => {
        colorrgb(r, g, b)
        fillrect(x1, y1, x2, y2, stockBattleUi.target)
        return 0
    },
    frame: (x1, y1, x2, y2, r, g, b) => {
        colorrgb(r, g, b)
        drawrect(x1, y1, x2, y2, stockBattleUi.target)
        return 0
    },
    words: (x, y, text, size, r, g, b) => {
        colorrgb(r, g, b)
        fontsize(size)
        pixeltext(x, y, text, stockBattleUi.target)
        return 0
    },
  // A bar is a dark track, a coloured fill of value/max, and a light border. It keeps no state.
    bar: (x, y, width, height, value, max, r, g, b) => {
        local(fill) = 0
        local(v) = value
        if (v < 0) {
            v = 0
        }
        if (v > max) {
            v = max
        }
        if (max > 0) {
            fill = integermuldiv(v, width - 2, max)
        }
        stockBattleUi.box(x, y, x + width - 1, y + height - 1, 32, 32, 40)
        if (fill > 0) {
            stockBattleUi.box(x + 1, y + 1, x + fill, y + height - 2, r, g, b)
        }
        stockBattleUi.frame(x, y, x + width - 1, y + height - 1, 200, 200, 210)
        return fill
    },
    fighterSprite: (fighter) => {
        local(stance) = "rest"
        local(file)
        local(source) = "" + fighter.source
        local(loop) = 1
        if (fighter.hp < 1) {
            stance = "die"
            loop = 0
        } else {
            if (stockBattleUi.acting != null) {
                if (stockBattleUi.acting == fighter.id) {
                    stance = stockBattleUi.actingStance
                }
            }
        }
        file = stockBattleUi.files[source + "|" + stance]
        if (file == null || file == "") {
            file = stockBattleUi.files[source + "|rest"]
            loop = 1
        }
        if (file == null) {
            file = ""
        }
        return { file: file, loop: loop }
    },
  // Enemies sit in a two-column grid; the party fills one right-hand column, and a fifth member starts a second
  // column further left, so no two 64-pixel pictures overlap at the five-member maximum.
    slotX: (party, index) => {
        local(layout) = stockBattleUi.layout
        if (party == 0) {
            return layout.enemyX + (index % 2) * layout.enemyDX
        }
        if (index > 2) {
            return layout.playerX - layout.playerDX
        }
        return layout.playerX
    },
    slotY: (party, index) => {
        local(layout) = stockBattleUi.layout
        if (party == 0) {
            return layout.enemyY + ((index - (index % 2)) / 2) * layout.enemyDY
        }
        return layout.playerY + (index % 3) * layout.playerDY
    },
  // Each fighter's picture is one engine-owned pinned animation (BAT-11 item 4): started here, ended and restarted only
  // when the stance file changes, and otherwise left alone, so its frames advance on the engine's own ticks whatever
  // the script is doing. The picture sits above the render-now canvas; this canvas never draws a fighter's picture.
    syncSprites: (first, last) => {
        local(position)
        local(fighter)
        local(sprite)
        local(key)
        local(want)
        for (position = first; position < last; position = position + 1) {
            fighter = battle.fighter(stockBattleUi.rosterParty[position], stockBattleUi.rosterIndex[position])
            if (fighter != null) {
                sprite = stockBattleUi.fighterSprite(fighter)
                key = sprite.file + "|" + sprite.loop
                if (key != stockBattleUi.spriteKey[position]) {
                    stockBattleUi.spriteKey[position] = key
                    if (stockBattleUi.spriteId[position] != 0) {
                        endanimation(stockBattleUi.spriteId[position])
                        stockBattleUi.spriteId[position] = 0
                    }
                    stockBattleUi.spriteHidden[position] = 0
                    if (sprite.file != "") {
                        stockBattleUi.spriteId[position] = pinnedanimation(sprite.file, stockBattleUi.slotX(stockBattleUi.rosterParty[position], stockBattleUi.rosterIndex[position]), stockBattleUi.slotY(stockBattleUi.rosterParty[position], stockBattleUi.rosterIndex[position]), sprite.loop)
                    }
                }
        // The open inventory list covers the field; keep pinned fighters visible during target selection.
                if (stockBattleUi.spriteId[position] != 0) {
                    want = 0
                    if (stockBattleUi.mode == "list") {
                        want = 1
                    }
                    if (want != stockBattleUi.spriteHidden[position]) {
                        stockBattleUi.spriteHidden[position] = want
                        showpinnedanimation(stockBattleUi.spriteId[position], 1 - want)
                    }
                }
            }
        }
        return 0
    },
  // Visibility follows the published canvas, not a mode whose redraw is still
  // being composed. Keep this pass separate from the more expensive stance walk.
    setSpritesHidden: (hidden) => {
        local(ids) = stockBattleUi.spriteId
        local(flags) = stockBattleUi.spriteHidden
        local(count) = stockBattleUi.rosterCount
        local(position)
        for (position = 0; position < count; position = position + 1) {
            if (ids[position] != 0 && flags[position] != hidden) {
                flags[position] = hidden
                showpinnedanimation(ids[position], 1 - hidden)
            }
        }
        return 0
    },
    endSprites: () => {
        local(position)
        for (position = 0; position < stockBattleUi.rosterCount; position = position + 1) {
            if (stockBattleUi.spriteId[position] != 0) {
                endanimation(stockBattleUi.spriteId[position])
                stockBattleUi.spriteId[position] = 0
            }
            stockBattleUi.spriteKey[position] = ""
        }
        return 0
    },
  // Duplicate names share suffixes between the battlefield and the target picker.
    targetLabel: (party, index, maxChars) => {
        local(fighter) = battle.fighter(party, index)
        local(candidate)
        local(size) = battle.partySize(party)
        local(matches) = 0
        local(rank) = 0
        local(position)
        local(suffix) = ""
        local(label)
        for (position = 0; position < size; position = position + 1) {
            candidate = battle.fighter(party, position)
            if (candidate != null && candidate.name == fighter.name) {
                matches = matches + 1
                if (position < index) {
                    rank = rank + 1
                }
            }
        }
        if (matches > 1) {
            if (rank == 0) { suffix = " A" }
            if (rank == 1) { suffix = " B" }
            if (rank == 2) { suffix = " C" }
            if (rank == 3) { suffix = " D" }
            if (rank == 4) { suffix = " E" }
        }
        label = fighter.name
        if (maxChars != null && maxChars > 0) {
            if (suffix != "" && maxChars > len(suffix)) {
                label = left(label, maxChars - len(suffix)) + suffix
            } else {
                label = left(label, maxChars)
            }
        } else {
            label = label + suffix
        }
        return label
    },
  // What the canvas draws for a fighter: the target cursor around its slot, a grey outline when it has no animation
  // at all, and, for an enemy, its name and HP bar beneath.
    drawFighter: (party, index, selected) => {
        local(layout) = stockBattleUi.layout
        local(fighter) = battle.fighter(party, index)
        local(x)
        local(y)
        local(size) = layout.sprite
        local(sprite)
        local(label)
        if (fighter == null) {
            return 0
        }
        x = stockBattleUi.slotX(party, index)
        y = stockBattleUi.slotY(party, index)
        sprite = stockBattleUi.fighterSprite(fighter)
        if (sprite.file == "") {
            stockBattleUi.frame(x, y, x + size - 1, y + size - 1, 120, 120, 130)
        }
        if (selected != 0) {
            stockBattleUi.frame(x - 4, y - 4, x + size + 3, y + size + 3, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
            stockBattleUi.frame(x - 5, y - 5, x + size + 4, y + size + 4, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
        }
        if (party == 0) {
            label = left(fighter.name, 8)
            if (stockBattleUi.labelParty == party) {
                label = stockBattleUi.targetLabel(party, index, 8)
            }
            if (fighter.hp < 1) {
                stockBattleUi.words(x, y + size + 3, label, 8, 130, 130, 140)
            } else {
                stockBattleUi.words(x, y + size + 3, label, 8, 255, 255, 255)
            }
            stockBattleUi.bar(x, y + size + 14, size, 6, fighter.hp, fighter.maxhp, 220, 64, 56)
        }
        return 0
    },
    drawChargeBar: (index, fighter) => {
        local(layout) = stockBattleUi.layout
        local(y) = layout.rowY + index * layout.rowDY
        local(fill)
        fill = battle.chargePercent(1, index)
        stockBattleUi.bar(layout.chargeX, y, layout.chargeW, layout.barH, fill, 100, 240, 200, 40)
        stockBattleUi.bars[index] = fill
        return 0
    },
    drawRow: (index) => {
        local(layout) = stockBattleUi.layout
        local(fighter) = battle.fighter(1, index)
        local(y) = layout.rowY + index * layout.rowDY
        local(name)
        if (fighter == null) {
            return 0
        }
        name = left(fighter.name, layout.nameChars)
        if (stockBattleUi.labelParty == 1) {
            name = stockBattleUi.targetLabel(1, index, layout.nameChars)
        }
        if (fighter.hp < 1) {
            stockBattleUi.words(layout.rowX, y, name, 16, 130, 130, 140)
        } else {
            if (stockBattleUi.menuIndex == index && (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target")) {
        // The active member row spans every status column, including the complete name.
                stockBattleUi.box(layout.partyX + 4, y - 2, layout.w - 13, y + 18, 30, 60, 90)
                stockBattleUi.words(layout.rowX, y, name, 16, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
            } else {
                stockBattleUi.words(layout.rowX, y, name, 16, 255, 255, 255)
            }
        }
        stockBattleUi.bar(layout.hpX, y, layout.hpW, layout.barH, fighter.hp, fighter.maxhp, 64, 200, 80)
        stockBattleUi.words(layout.hpX + 4, y + 3, "HP " + fighter.hp + "/" + fighter.maxhp, 8, 255, 255, 255)
        stockBattleUi.bar(layout.smpX, y, layout.smpW, layout.barH, fighter.smp, fighter.maxsmp, 72, 132, 255)
        stockBattleUi.words(layout.smpX + 4, y + 3, "SP " + fighter.smp + "/" + fighter.maxsmp, 8, 255, 255, 255)
        stockBattleUi.drawChargeBar(index, fighter)
        return 0
    },
    drawCommandBase: () => {
        local(layout) = stockBattleUi.layout
        stockBattleUi.box(layout.cmdX, layout.panelY, layout.cmdX + layout.cmdW - 1, layout.h - 1, 12, 16, 40)
        stockBattleUi.frame(layout.cmdX, layout.panelY, layout.cmdX + layout.cmdW - 1, layout.h - 1, 140, 150, 200)
        return 0
    },
    drawCommands: () => {
        local(layout) = stockBattleUi.layout
        local(fighter) = battle.fighter(1, stockBattleUi.menuIndex)
        local(labels) = {}
        local(dim) = {}
        local(row)
        local(x)
        local(y)
        local(width)
        local(data) = stockBattleUi.chars["" + fighter.id]
        local(special) = "Special"
        labels[0] = "Fight"
        if (data != null) {
            if (data.specialname != "") {
                special = data.specialname
            }
        }
        labels[1] = special
        labels[2] = "Items"
        labels[3] = "Run"
        dim[0] = 0
        dim[1] = stockBattleUi.specialsEmpty
        dim[2] = stockBattleUi.itemsEmpty
        dim[3] = 0
        if (stockBattle.canRun() == 0) {
            dim[3] = 1
        }
    // Visual reference alignment: vertical command panel sits in the bottom-left alongside the wider party status panel.
        x = layout.cmdX
        width = layout.cmdW
        y = layout.panelY
        stockBattleUi.box(x, y, x + width - 1, y + layout.panelH - 1, 12, 16, 40)
        stockBattleUi.frame(x, y, x + width - 1, y + layout.panelH - 1, 180, 190, 255)
        for (row = 0; row < 4; row = row + 1) {
            local(itemY) = y + 10 + row * 26
            local(labelLimit) = integermuldiv(width - 30, 1, 16)
            local(label) = left(labels[row], labelLimit)
            local(textR) = 255
            local(textG) = 255
            local(textB) = 255
            if (len(labels[row]) > labelLimit) {
                label = left(labels[row], labelLimit - 3) + "..."
            }
            if (row == stockBattleUi.cursor) {
                stockBattleUi.box(x + 4, itemY - 2, x + width - 5, itemY + 22, 40, 64, 140)
                stockBattleUi.words(x + 6, itemY + 2, ">", 16, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
                textR = stockBattleUi.highlight.r
                textG = stockBattleUi.highlight.g
                textB = stockBattleUi.highlight.b
            }
            if (dim[row] != 0) {
                stockBattleUi.words(x + 22, itemY + 2, label, 16, 110, 110, 120)
                if (row == 3) {
          // A blocked Run is still listed, drawn dim and struck through.
                    stockBattleUi.box(x + 22, itemY + 9, x + 22 + len(label) * 12, itemY + 10, 110, 110, 120)
                }
            } else {
                stockBattleUi.words(x + 22, itemY + 2, label, 16, textR, textG, textB)
            }
        }
        return 0
    },
  // Visual reference direction (`clipboard-2026-10-26-222322-7E56F8E8.png`): when browsing Special moves or Items,
  // show a prominent contextual description header bar across the top of the list, a broad overlay across the field
  // with selection highlight and cost/count, while the bottom command and party panels remain visible below.
    drawList: () => {
        local(layout) = stockBattleUi.layout
        local(fighter) = battle.fighter(1, stockBattleUi.menuIndex)
        local(rows) = stockBattleUi.listCount
        local(row)
        local(entry)
        local(selectedEntry) = stockBattleUi.list[stockBattleUi.listCursor]
        local(data) = stockBattleUi.chars["" + fighter.id]
        local(title) = "Items"
        local(desc) = ""
        local(x) = 16
        local(width) = layout.w - 32
        local(y) = 28
        local(titleLimit)
        local(selectedLabel) = ""
        local(selectedLabelLimit) = integermuldiv(width - 24, 1, 8)
        local(descLimit) = integermuldiv(width - 24, 1, 8)
        local(descText) = ""
        if (stockBattleUi.listKind == "special") {
            title = "Special Moves"
            if (data != null && data.specialname != "") {
                title = data.specialname
            }
        }
        if (selectedEntry != null && selectedEntry.desc != "") {
            desc = selectedEntry.desc
        }
        descText = "" + desc
        if (len(descText) > descLimit) {
            descText = left(descText, descLimit - 3) + "..."
        }
        if (selectedEntry != null) {
            selectedLabel = "" + selectedEntry.label
            if (len(selectedLabel) > selectedLabelLimit) {
                selectedLabel = left(selectedLabel, selectedLabelLimit - 3) + "..."
            }
        }
    // The page that holds the cursor: sixteen entries at most, eight to a column.
        local(capacity) = layout.listCapacity
        local(first) = stockBattleUi.listTop
        local(last) = first + capacity
        local(pages) = integermuldiv(rows + capacity - 1, 1, capacity)
        if (last > rows) {
            last = rows
        }
        titleLimit = integermuldiv(width - 24, 1, 8)
        if (pages > 1) {
            titleLimit = integermuldiv(width - 88, 1, 8)
        }
    // Top description box across the list panel; clip authored text inside the frame.
        stockBattleUi.box(x, y, x + width - 1, y + 42, 16, 20, 48)
        stockBattleUi.frame(x, y, x + width - 1, y + 42, 180, 190, 255)
        stockBattleUi.words(x + 12, y + 6, left(title, titleLimit), 8, 180, 190, 255)
        if (pages > 1) {
            stockBattleUi.words(x + width - 64, y + 6, "" + (integermuldiv(first, 1, capacity) + 1) + "/" + pages, 8, 180, 190, 255)
        }
        if (descText != "") {
            stockBattleUi.words(x + 12, y + 18, descText, 8, 255, 255, 255)
        }
        if (selectedLabel != "") {
            stockBattleUi.words(x + 12, y + 27, selectedLabel, 8, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
        }
    // Two-column list box: up to eight entries per column, sized to fit the entries of this page.
        local(listY) = y + 42
        local(listRows) = last - first
        if (listRows > layout.listRows) {
            listRows = layout.listRows
        }
        if (listRows < 3) {
            listRows = 3
        }
    // Fill to the command/status panel edge so lower battlefield labels and HP bars cannot leak through.
        local(listH) = layout.panelY - listY
        stockBattleUi.box(x, listY, x + width - 1, listY + listH - 1, 12, 16, 40)
        stockBattleUi.frame(x, listY, x + width - 1, listY + listH - 1, 180, 190, 255)
        local(colW) = (width - 16) / 2
        for (row = first; row < last; row = row + 1) {
            entry = stockBattleUi.list[row]
            local(col) = 0
            local(itemRow) = row - first
            local(itemX)
            local(itemY)
            local(rowRight)
            local(labelText)
            local(detailText)
            local(detailLimit)
            local(labelLimit)
            local(detailX)
            local(textR) = 255
            local(textG) = 255
            local(textB) = 255
            if (itemRow >= layout.listRows) {
                col = 1
                itemRow = itemRow - layout.listRows
            }
            itemX = x + 8 + col * colW
            itemY = listY + 8 + itemRow * layout.listRowH
            rowRight = itemX + colW - 8
            labelText = "" + entry.label
            detailText = "" + entry.detail
            detailLimit = 12
            if (len(detailText) > detailLimit) {
                detailText = left(detailText, detailLimit - 3) + "..."
            }
            detailX = rowRight - len(detailText) * 8 + 1
            labelLimit = integermuldiv(detailX - itemX - 30, 1, 16)
            if (labelLimit < 1) {
                labelLimit = 1
            }
            if (len(labelText) > labelLimit) {
                if (labelLimit > 3) {
                    labelText = left(labelText, labelLimit - 3) + "..."
                } else {
                    labelText = left(labelText, labelLimit)
                }
            }
            if (row == stockBattleUi.listCursor) {
                stockBattleUi.box(itemX, itemY - 2, rowRight, itemY + 26, 40, 64, 140)
                stockBattleUi.words(itemX + 4, itemY + 4, ">", 16, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
                textR = stockBattleUi.highlight.r
                textG = stockBattleUi.highlight.g
                textB = stockBattleUi.highlight.b
            }
            if (entry.affordable == 0) {
                textR = 110
                textG = 110
                textB = 120
                if (row == stockBattleUi.listCursor) {
          // Dim unavailable moves without losing contrast against the selection band.
                    textR = 180
                    textG = 180
                    textB = 190
                }
            }
            stockBattleUi.words(itemX + 24, itemY + 4, labelText, 16, textR, textG, textB)
            if (entry.affordable == 0) {
                if (row == stockBattleUi.listCursor) {
                    stockBattleUi.words(detailX, itemY + 8, detailText, 8, 180, 180, 190)
                } else {
                    stockBattleUi.words(detailX, itemY + 8, detailText, 8, 110, 110, 120)
                }
            } else {
                stockBattleUi.words(detailX, itemY + 8, detailText, 8, 200, 220, 255)
            }
        }
        return 0
    },
    drawTargetBase: () => {
        local(layout) = stockBattleUi.layout
        local(x) = layout.cmdX
        local(width) = layout.cmdW
        local(row)
        local(boxBottom) = layout.messageY - 1
        local(boxHeight) = 14 + stockBattleUi.targetCount * 17
        local(rowY)
        local(boxY) = boxBottom - boxHeight + 1
        stockBattleUi.box(x, boxY, x + width - 1, boxBottom, 12, 16, 40)
        stockBattleUi.frame(x, boxY, x + width - 1, boxBottom, 180, 190, 255)
        stockBattleUi.words(x + 6, boxY + 3, "Choose Target", 8, 180, 190, 255)
        rowY = boxY + 14
        for (row = 0; row < stockBattleUi.targetCount; row = row + 1) {
            stockBattleUi.words(x + 18, rowY + row * 17 + 4, stockBattleUi.targetLabels[row], 8, 255, 255, 255)
        }
        return 0
    },
  // Refresh duplicate-aware target names after a fighter changes.
    drawTargetNames: () => {
        local(layout) = stockBattleUi.layout
        local(party) = stockBattleUi.targetParty
        local(size) = battle.partySize(party)
        local(index)
        local(fighter)
        local(label)
        local(x)
        local(y)
        for (index = 0; index < size; index = index + 1) {
            fighter = battle.fighter(party, index)
            if (fighter != null) {
                label = stockBattleUi.targetLabel(party, index, 8)
                if (party == 0) {
                    x = stockBattleUi.slotX(party, index)
                    y = stockBattleUi.slotY(party, index)
                    if (fighter.hp < 1) {
                        stockBattleUi.words(x, y + layout.sprite + 3, label, 8, 130, 130, 140)
                    } else {
                        stockBattleUi.words(x, y + layout.sprite + 3, label, 8, 255, 255, 255)
                    }
                } else {
                    label = stockBattleUi.targetLabel(party, index, layout.nameChars)
                    y = layout.rowY + index * layout.rowDY
                    if (fighter.hp < 1) {
                        stockBattleUi.words(layout.rowX, y, label, 16, 130, 130, 140)
                    } else {
                        if (stockBattleUi.menuIndex == index) {
                            stockBattleUi.words(layout.rowX, y, label, 16, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
                        } else {
                            stockBattleUi.words(layout.rowX, y, label, 16, 255, 255, 255)
                        }
                    }
                }
            }
        }
        return 0
    },
  // A rename can change duplicate suffixes on every target, so erase the old
  // glyphs before drawing the newly computed labels.
    clearTargetNames: () => {
        local(layout) = stockBattleUi.layout
        local(party) = stockBattleUi.targetParty
        local(size) = battle.partySize(party)
        local(index)
        local(x)
        local(y)
        local(patch)
        local(fighter)
        for (index = 0; index < size; index = index + 1) {
            fighter = battle.fighter(party, index)
            if (fighter != null) {
                if (party == 0) {
                    x = stockBattleUi.slotX(0, index)
                    y = stockBattleUi.slotY(0, index) + layout.sprite + 3
                    patch = createcanvas(layout.sprite, 8)
                    drawcanvas(stockBattleUi.background[index], 0, 0, layout.sprite, 17, patch)
                    drawcanvas(patch, x, y, layout.sprite, 8, stockBattleUi.target)
                    killcanvas(patch)
                } else {
                    y = layout.rowY + index * layout.rowDY
                    if (fighter.hp > 0 && stockBattleUi.menuIndex == index) {
                        stockBattleUi.box(layout.rowX, y, layout.hpX - 1, y + 15, 30, 60, 90)
                    } else {
                        stockBattleUi.box(layout.rowX, y, layout.hpX - 1, y + 15, 12, 16, 40)
                    }
                }
            }
        }
        return 0
    },
    drawTargetCursor: () => {
        local(layout) = stockBattleUi.layout
        local(x) = layout.cmdX
        local(width) = layout.cmdW
        local(boxBottom) = layout.messageY - 1
        local(boxHeight) = 14 + stockBattleUi.targetCount * 17
        local(rowY) = boxBottom - boxHeight + 15
        local(row) = stockBattleUi.targetCursor
        local(index) = stockBattleUi.targets[row]
        local(fighter) = battle.fighter(stockBattleUi.targetParty, index)
        local(label) = stockBattleUi.targetLabels[row]
        local(messageChars) = integermuldiv(layout.w - 16, 1, 8)
        local(messageText) = "Target: " + stockBattleUi.targetFullLabels[row]
        local(slotX)
        local(slotY)
        if (len(messageText) > messageChars) {
            messageText = left(messageText, messageChars - 3) + "..."
        }
        stockBattleUi.box(x + 1, rowY + row * 17 - 1, x + width - 2, rowY + row * 17 + 15, 40, 64, 140)
        stockBattleUi.words(x + 4, rowY + row * 17 + 4, ">", 8, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
        stockBattleUi.words(x + 18, rowY + row * 17 + 4, label, 8, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
        stockBattleUi.box(0, layout.messageY, layout.w - 1, layout.messageY + layout.messageH - 1, 12, 16, 40)
        stockBattleUi.frame(0, layout.messageY, layout.w - 1, layout.messageY + layout.messageH - 1, 180, 190, 255)
        stockBattleUi.words(8, layout.messageY + 6, messageText, 8, 255, 255, 255)
        if (fighter != null) {
            slotX = stockBattleUi.slotX(stockBattleUi.targetParty, index)
            slotY = stockBattleUi.slotY(stockBattleUi.targetParty, index)
            stockBattleUi.frame(slotX - 4, slotY - 4, slotX + layout.sprite + 3, slotY + layout.sprite + 3, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
            stockBattleUi.frame(slotX - 5, slotY - 5, slotX + layout.sprite + 4, slotY + layout.sprite + 4, stockBattleUi.highlight.r, stockBattleUi.highlight.g, stockBattleUi.highlight.b)
        }
        return 0
    },
    drawNumbers: () => {
        local(index)
        local(entry)
        local(x)
        local(y)
        for (index = 0; index < stockBattleUi.numberCount; index = index + 1) {
            entry = stockBattleUi.numbers[index]
            x = stockBattleUi.slotX(entry.party, entry.index)
            y = stockBattleUi.slotY(entry.party, entry.index)
            if (entry.kind == "damage") {
                stockBattleUi.words(x + 2, y - 10, entry.text, 8, 255, 96, 96)
            }
            if (entry.kind == "heal") {
                stockBattleUi.words(x + 2, y - 10, entry.text, 8, 96, 255, 112)
            }
            if (entry.kind == "smp") {
                stockBattleUi.words(x + 34, y - 10, entry.text, 8, 120, 170, 255)
            }
        }
        return 0
    },
  // The signature is every value the full redraw shows. A pass redraws only when it changed; the charge bars repaint
  // on their own, because a bar's width changes nearly every pass. Fighter animation is not part of it: the engine
  // plays the pinned animations by itself.
    chromeSignature: () => {
        local(index)
        local(fighter)
        local(entry)
        local(target)
        local(previous)
        local(text) = "" + stockBattleUi.mode + "|" + stockBattleUi.menuIndex + "|" + stockBattleUi.cursor + "|" + stockBattleUi.listCursor + "|" + stockBattleUi.listTop + "|" + stockBattleUi.targetCursor + "|" + stockBattleUi.targetParty + "|" + stockBattleUi.numberCount + "|" + stockBattleUi.message + "|" + stockBattleUi.actingStance + "|" + stockBattleUi.listCount
        if (stockBattleUi.mode == "list") {
            entry = stockBattleUi.list[stockBattleUi.listCursor]
            if (entry != null) {
                text = text + "|entry:" + entry.label + "|" + entry.detail + "|" + entry.desc + "|" + entry.affordable
            }
        }
        if (stockBattleUi.mode == "target" && stockBattleUi.targetCount > 0) {
            target = battle.fighter(stockBattleUi.targetParty, stockBattleUi.targets[stockBattleUi.targetCursor])
            if (target != null) {
                text = text + "|target:" + target.id
            }
        }
        if (stockBattleUi.acting == null) {
            text = text + "|acting:none"
        } else {
            text = text + "|acting:" + stockBattleUi.acting
        }
        stockBattleUi.nextControlSig = text
        stockBattleUi.changedCount = 0
        if (stockBattleUi.staticSig == "") {
      // The first call is followed by a full draw of every value, so there is nothing to compare yet.
            return text + "|stats:" + stockBattleUi.statsRevision
        }
        for (index = 0; index < stockBattleUi.rosterCount; index = index + 1) {
            fighter = stockBattleUi.roster[index]
            previous = stockBattleUi.cachedStats[index]
            if (fighter.hp != previous.hp || fighter.smp != previous.smp || fighter.maxhp != previous.maxhp || fighter.maxsmp != previous.maxsmp || fighter.name != previous.name) {
                stockBattleUi.changedSlot[stockBattleUi.changedCount] = index
                stockBattleUi.changedName[stockBattleUi.changedCount] = 0
                if (fighter.name != previous.name) {
                    stockBattleUi.changedName[stockBattleUi.changedCount] = 1
                }
                stockBattleUi.cachedStats[index] = { name: fighter.name, hp: fighter.hp, maxhp: fighter.maxhp, smp: fighter.smp, maxsmp: fighter.maxsmp }
                stockBattleUi.changedCount = stockBattleUi.changedCount + 1
            }
        }
        if (stockBattleUi.changedCount > 0) {
            stockBattleUi.statsRevision = stockBattleUi.statsRevision + 1
        }
        return text + "|stats:" + stockBattleUi.statsRevision
    },
  // The canonical battle scene is independent of list and target cursors so they can be composited quickly.
    backdropSignature: () => {
        local(index)
        local(fighter)
        local(entry)
        local(text) = "" + stockBattleUi.menuIndex + "|" + stockBattleUi.numberCount + "|" + stockBattleUi.message + "|" + stockBattleUi.actingStance
        if (stockBattleUi.mode == "target") {
            text = text + "|target-names:" + stockBattleUi.targetParty
        }
        if (stockBattleUi.acting == null) {
            text = text + "|acting:none"
        } else {
            text = text + "|acting:" + stockBattleUi.acting
        }
        for (index = 0; index < stockBattleUi.numberCount; index = index + 1) {
            entry = stockBattleUi.numbers[index]
            text = text + "|number:" + entry.party + "," + entry.index + "," + entry.kind + "," + entry.text
        }
        for (index = 0; index < stockBattleUi.rosterCount; index = index + 1) {
            fighter = stockBattleUi.roster[index]
            text = text + "|" + fighter.name + "," + fighter.hp + "," + fighter.maxhp + "," + fighter.smp + "," + fighter.maxsmp
        }
        return text
    },
    drawOverlay: () => {
        local(layout) = stockBattleUi.layout
        local(size) = battle.partySize(1)
        local(index)
        stockBattleUi.target = stockBattleUi.buffer
        for (index = 0; index < size; index = index + 1) {
            stockBattleUi.drawChargeBar(index, battle.fighter(1, index))
        }
        drawcanvas(stockBattleUi.buffer, 0, 0, layout.w, layout.h, stockBattleUi.overlayScratch)
        stockBattleUi.target = stockBattleUi.overlayScratch
        if (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target") {
            stockBattleUi.drawCommands()
        }
        if (stockBattleUi.mode == "list") {
            stockBattleUi.drawList()
        }
        if (stockBattleUi.mode == "target") {
      // A rename and cursor move can share this path, bypassing the stat-only
      // patch. Ordinary cursor moves keep their already-current labels.
            local(nameChanged) = 0
            for (index = 0; index < stockBattleUi.changedCount; index = index + 1) {
                if (stockBattleUi.changedName[index] != 0 && stockBattleUi.rosterParty[stockBattleUi.changedSlot[index]] == stockBattleUi.targetParty) {
                    nameChanged = 1
                }
            }
            if (nameChanged != 0) {
                for (index = 0; index < stockBattleUi.targetCount; index = index + 1) {
                    stockBattleUi.targetLabels[index] = stockBattleUi.targetLabel(stockBattleUi.targetParty, stockBattleUi.targets[index], 8)
                    stockBattleUi.targetFullLabels[index] = stockBattleUi.targetLabel(stockBattleUi.targetParty, stockBattleUi.targets[index], 0)
                }
            }
            stockBattleUi.drawTargetBase()
            stockBattleUi.drawTargetCursor()
        }
        if (stockBattleUi.mode == "list") {
            stockBattleUi.setSpritesHidden(1)
        }
        drawcanvas(stockBattleUi.overlayScratch, 0, 0, layout.w, layout.h, stockBattleUi.screen)
        stockBattleUi.target = stockBattleUi.screen
        if (stockBattleUi.mode != "list") {
            stockBattleUi.setSpritesHidden(0)
        }
        stockBattleUi.syncSprites(0, stockBattleUi.rosterCount)
        return 0
    },
  // Publish a small rectangle from the cached scene using clipped canvas blits.
    patchFighter: (position) => {
        local(layout) = stockBattleUi.layout
        local(party) = stockBattleUi.rosterParty[position]
        local(index) = stockBattleUi.rosterIndex[position]
        local(x)
        local(y)
        local(width)
        local(height)
        local(patch)
        local(destination) = stockBattleUi.screen
        if (stockBattleUi.mode == "target") {
            destination = stockBattleUi.overlayScratch
        }
        if (party == 1) {
            x = layout.partyX + 4
            y = layout.rowY + index * layout.rowDY - 2
            width = layout.w - 13 - x + 1
            height = 21
            stockBattleUi.target = stockBattleUi.buffer
            stockBattleUi.box(x, y, x + width - 1, y + height - 1, 12, 16, 40)
            stockBattleUi.drawRow(index)
        } else {
            x = stockBattleUi.slotX(0, index)
            y = stockBattleUi.slotY(0, index) + layout.sprite + 3
            width = layout.sprite
            height = 17
            drawcanvas(stockBattleUi.background[index], x, y, width, height, stockBattleUi.buffer)
            stockBattleUi.target = stockBattleUi.buffer
            stockBattleUi.drawFighter(0, index, 0)
        }
        patch = createcanvas(width, height)
        drawcanvas(stockBattleUi.buffer, 0 - x, 0 - y, layout.w, layout.h, patch)
        if (party == 1 || stockBattleUi.mode != "list") {
            drawcanvas(patch, x, y, width, height, destination)
        }
        killcanvas(patch)
        stockBattleUi.target = stockBattleUi.screen
        stockBattleUi.sceneBaseValid = 0
        stockBattleUi.syncSprites(position, position + 1)
        return 0
    },
    refresh: () => {
        local(chrome) = stockBattleUi.chromeSignature()
        local(size)
        local(index)
        local(slot)
        local(fill)
        local(layout) = stockBattleUi.layout
        local(targetChanged) = 0
        local(nameChanged) = 0
        if (chrome != stockBattleUi.staticSig) {
            stockBattleUi.staticSig = chrome
            if (stockBattleUi.controlSig == stockBattleUi.nextControlSig) {
                if (stockBattleUi.mode == "target") {
                    drawcanvas(stockBattleUi.screen, 0, 0, layout.w, layout.h, stockBattleUi.overlayScratch)
                }
                for (index = 0; index < stockBattleUi.changedCount; index = index + 1) {
                    slot = stockBattleUi.changedSlot[index]
                    if (stockBattleUi.mode == "target" && stockBattleUi.rosterParty[slot] == stockBattleUi.targetParty) {
                        targetChanged = 1
                        if (stockBattleUi.changedName[index] != 0) {
                            nameChanged = 1
                        }
                    }
                    stockBattleUi.patchFighter(slot)
                }
                if (stockBattleUi.mode == "target") {
                    stockBattleUi.target = stockBattleUi.overlayScratch
                    if (targetChanged != 0) {
                        stockBattleUi.clearTargetNames()
                        stockBattleUi.drawTargetNames()
                    }
                    if (nameChanged != 0) {
                        for (index = 0; index < stockBattleUi.targetCount; index = index + 1) {
                            stockBattleUi.targetLabels[index] = stockBattleUi.targetLabel(stockBattleUi.targetParty, stockBattleUi.targets[index], 8)
                            stockBattleUi.targetFullLabels[index] = stockBattleUi.targetLabel(stockBattleUi.targetParty, stockBattleUi.targets[index], 0)
                        }
                        stockBattleUi.drawTargetBase()
                        stockBattleUi.drawTargetCursor()
                    }
                    drawcanvas(stockBattleUi.overlayScratch, 0, 0, layout.w, layout.h, stockBattleUi.screen)
                    stockBattleUi.target = stockBattleUi.screen
                }
                if (stockBattleUi.on != 0) {
                    size = battle.partySize(1)
                    for (index = 0; index < size; index = index + 1) {
                        fill = battle.chargePercent(1, index)
                        if (stockBattleUi.bars[index] != fill) {
                            if (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target") {
                                stockBattleUi.target = stockBattleUi.buffer
                                stockBattleUi.drawChargeBar(index, battle.fighter(1, index))
                            }
                            stockBattleUi.target = stockBattleUi.screen
                            stockBattleUi.drawChargeBar(index, battle.fighter(1, index))
                        }
                    }
                }
                return 1
            }
            stockBattleUi.controlSig = stockBattleUi.nextControlSig
            if (stockBattleUi.sceneBaseValid != 0 && stockBattleUi.backdropSignature() == stockBattleUi.sceneBaseSig) {
                if (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target") {
                    stockBattleUi.drawOverlay()
                    return 1
                }
            }
            stockBattleUi.draw()
            return 1
        }
        size = battle.partySize(1)
        if (size > 0) {
            index = stockBattleUi.barScan
            if (index >= size) {
                index = 0
            }
            fill = battle.chargePercent(1, index)
            if (stockBattleUi.bars[index] != fill) {
                if (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target") {
                    stockBattleUi.target = stockBattleUi.buffer
                    stockBattleUi.drawChargeBar(index, battle.fighter(1, index))
                }
                stockBattleUi.target = stockBattleUi.screen
                stockBattleUi.drawChargeBar(index, battle.fighter(1, index))
            }
            stockBattleUi.barScan = (index + 1) % size
        }
        return 0
    },
    draw: () => {
        local(layout) = stockBattleUi.layout
        local(party)
        local(index)
        local(size)
    // Build a mode-independent battle scene so list and target overlays can be swapped in a single quick blit.
        stockBattleUi.labelParty = -1
        if (stockBattleUi.mode == "target") {
            stockBattleUi.labelParty = stockBattleUi.targetParty
        }
        stockBattleUi.target = stockBattleUi.buffer
        if (stockBattleUi.picture != "") {
            bitmap(stockBattleUi.picture, stockBattleUi.target)
        } else {
            stockBattleUi.box(0, 0, layout.w - 1, layout.h - 1, 20, 28, 56)
        }
        if (stockBattleUi.backgroundCount == 0) {
      // One clean strip under each enemy's name and HP bar (the slot arithmetic of slotX/slotY, inlined).
            local(strips) = stockBattleUi.background
            local(copy) = stockBattleUi.buffer
            local(odd)
            size = battle.partySize(0)
            for (index = 0; index < size; index = index + 1) {
                odd = index % 2
                strips[index] = createcanvas(layout.sprite, 17)
                drawcanvas(copy, 0 - layout.enemyX - odd * layout.enemyDX, 0 - layout.enemyY - (index - odd) / 2 * layout.enemyDY - layout.sprite - 3, layout.w, layout.h, strips[index])
            }
            stockBattleUi.backgroundCount = size
        }
        stockBattleUi.box(layout.partyX, layout.panelY, layout.w - 9, layout.h - 1, 12, 16, 40)
        stockBattleUi.frame(layout.partyX, layout.panelY, layout.w - 9, layout.h - 1, 180, 190, 255)
        size = battle.partySize(1)
        for (index = 0; index < size; index = index + 1) {
            stockBattleUi.drawRow(index)
        }
        if (stockBattleUi.message != "") {
            stockBattleUi.box(0, layout.messageY, layout.w - 1, layout.messageY + layout.messageH - 1, 12, 16, 40)
            stockBattleUi.frame(0, layout.messageY, layout.w - 1, layout.messageY + layout.messageH - 1, 180, 190, 255)
            stockBattleUi.words(8, layout.messageY + 6, stockBattleUi.message, 8, 255, 255, 255)
        }
        for (party = 0; party < 2; party = party + 1) {
            size = battle.partySize(party)
            for (index = 0; index < size; index = index + 1) {
                stockBattleUi.drawFighter(party, index, 0)
            }
        }
        stockBattleUi.labelParty = -1
        stockBattleUi.drawCommandBase()
        stockBattleUi.drawNumbers()
        stockBattleUi.sceneBaseSig = stockBattleUi.backdropSignature()
        if (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target") {
            stockBattleUi.sceneBaseValid = 1
        } else {
            stockBattleUi.sceneBaseValid = 0
        }
        if (stockBattleUi.mode == "command" || stockBattleUi.mode == "list" || stockBattleUi.mode == "target") {
            stockBattleUi.drawOverlay()
        } else {
            drawcanvas(stockBattleUi.buffer, 0, 0, layout.w, layout.h, stockBattleUi.screen)
            stockBattleUi.target = stockBattleUi.screen
            stockBattleUi.setSpritesHidden(0)
            stockBattleUi.syncSprites(0, stockBattleUi.rosterCount)
        }
        return 0
    },
}

// ---- the interaction half of the screen: key mapping, the player's turn and the numbers after an action ----------
stockBattleUi.snapshot = () => {
    local(party)
    local(index)
    local(size)
    local(fighter)
    local(result) = {}
    for (party = 0; party < 2; party = party + 1) {
        size = battle.partySize(party)
        for (index = 0; index < size; index = index + 1) {
            fighter = battle.fighter(party, index)
            if (fighter != null) {
                result["" + party + "_" + index] = { hp: fighter.hp, smp: fighter.smp }
            }
        }
    }
    return result
}

// Compare the battle with the snapshot taken before an action and list what changed as damage numbers: HP lost is
// red, HP gained green, SMP changed blue. Nothing is written to the battle.
stockBattleUi.collectNumbers = (before) => {
    local(party)
    local(index)
    local(size)
    local(fighter)
    local(was)
    local(delta)
    stockBattleUi.numbers = {}
    stockBattleUi.numberCount = 0
    for (party = 0; party < 2; party = party + 1) {
        size = battle.partySize(party)
        for (index = 0; index < size; index = index + 1) {
            fighter = battle.fighter(party, index)
            was = before["" + party + "_" + index]
            if (fighter != null && was != null) {
                delta = fighter.hp - was.hp
                if (delta < 0) {
                    stockBattleUi.numbers[stockBattleUi.numberCount] = { party: party, index: index, kind: "damage", text: "" + (0 - delta) }
                    stockBattleUi.numberCount = stockBattleUi.numberCount + 1
                }
                if (delta > 0) {
                    stockBattleUi.numbers[stockBattleUi.numberCount] = { party: party, index: index, kind: "heal", text: "+" + delta }
                    stockBattleUi.numberCount = stockBattleUi.numberCount + 1
                }
                delta = fighter.smp - was.smp
                if (delta != 0) {
                    stockBattleUi.numbers[stockBattleUi.numberCount] = { party: party, index: index, kind: "smp", text: "SP " + delta }
                    stockBattleUi.numberCount = stockBattleUi.numberCount + 1
                }
            }
        }
    }
    return stockBattleUi.numberCount
}

stockBattleUi.hold = (ticks) => {
    stockBattleUi.refresh()
    threadsleep(getthreadid(), ticks/60)
    return 0
}

// After an action: show its numbers (and the message, when there is one) for a fixed number of ticks, then clear
// them with the message and the stance. An action that changed nothing and says nothing costs no ticks.
stockBattleUi.settle = (before, label) => {
    stockBattleUi.mode = "act"
    stockBattleUi.collectNumbers(before)
    if (stockBattleUi.numberCount > 0 && label != "") {
        stockBattleUi.message = label
    }
    if (stockBattleUi.numberCount > 0 || stockBattleUi.message != "") {
        stockBattleUi.hold(stockBattleUi.layout.numberTicks)
    }
    stockBattleUi.numbers = {}
    stockBattleUi.numberCount = 0
    stockBattleUi.message = ""
    stockBattleUi.acting = null
    stockBattleUi.actingStance = ""
    stockBattleUi.mode = "idle"
    stockBattleUi.refresh()
    return 0
}

stockBattleUi.base = (path) => {
    local(name) = path
    local(slash) = instr(name, "/")
    while (slash > 0) {
        name = mid(name, slash + 1, len(name) - slash)
        slash = instr(name, "/")
    }
    slash = instr(name, "\\")
    while (slash > 0) {
        name = mid(name, slash + 1, len(name) - slash)
        slash = instr(name, "\\")
    }
    name = replace(name, ".spc", "")
    name = replace(name, ".SPC", "")
    name = replace(name, ".itm", "")
    name = replace(name, ".ITM", "")
    return name
}

// The player's Special list: the learned moves whose own battle byte says usable (0), with their SMP cost; one the
// player cannot afford stays listed but dim. The Item list: the available stacks whose item says usable in battle.
stockBattleUi.prepareLists = (fighter) => {
    local(data) = stockBattleUi.chars["" + fighter.id]
    local(slot)
    local(move)
    local(file)
    local(inventory)
    local(index)
    local(stack)
    local(item)
    local(key)
  // BAT-11: the list shows what is available now, so the character's file is read again for every turn.
    if (data != null) {
        data = battlecharacterdata(fighter)
        stockBattleUi.chars["" + fighter.id] = data
    }
    stockBattleUi.specials = {}
    stockBattleUi.specialCount = 0
    stockBattleUi.items = {}
    stockBattleUi.itemcount = 0
    if (data != null) {
        if (data.hasspecial == 1) {
            for (index = 0; index < data.specialcount; index = index + 1) {
                slot = data.specialmoves[index]
                if (slot.available == 1) {
                    file = slot.file
                    move = stockBattle.specialDataCache[file]
                    if (move == null) {
                        move = battlemovedata(file)
                        if (move != null) {
                            stockBattle.specialDataCache[file] = move
                        }
                    }
                    if (move != null) {
                        if (move.battle == 0) {
                            stockBattleUi.specials[stockBattleUi.specialCount] = {
                                label: stockBattleUi.base(file), detail: "SP " + move.smp, desc: "" + move.description, file: file, data: move, affordable: 1
                            }
                            if (move.smp > fighter.smp) {
                                stockBattleUi.specials[stockBattleUi.specialCount].affordable = 0
                            }
                            stockBattleUi.specialCount = stockBattleUi.specialCount + 1
                        }
                    }
                }
            }
        }
    }
    inventory = battleinventory()
    for (index = 0; index < inventory.count; index = index + 1) {
        stack = inventory.items[index]
        key = lcase(stack.source)
        item = stockBattleUi.itemData[key]
        if (item == null) {
            item = battleitemdata(stack.source)
            if (item != null) {
                stockBattleUi.itemData[key] = item
            }
        }
        if (item != null) {
            if (item.usable == 1) {
                stockBattleUi.items[stockBattleUi.itemcount] = {
                    label: stack.handle, handle: stack.handle, detail: "x" + stack.quantity, desc: "" + item.description, file: stack.source, quantity: stack.quantity, data: item, affordable: 1
                }
                stockBattleUi.itemcount = stockBattleUi.itemcount + 1
            }
        }
    }
    stockBattleUi.specialsEmpty = 0
    if (stockBattleUi.specialCount < 1) {
        stockBattleUi.specialsEmpty = 1
    }
    stockBattleUi.itemsEmpty = 0
    if (stockBattleUi.itemcount < 1) {
        stockBattleUi.itemsEmpty = 1
    }
    return 0
}

// Fight and offensive Special target living enemies. Items may target any party member, including the fallen; a healing
// Special (negative FP) targets the player's party and also includes fallen members for revive selection.
stockBattleUi.collectTargets = (kind) => {
    local(party) = 0
    local(index)
    local(size)
    local(fighter)
    local(canHeal) = 0
    stockBattleUi.targets = {}
    stockBattleUi.targetLabels = {}
    stockBattleUi.targetFullLabels = {}
    stockBattleUi.targetCount = 0
    if (kind == "item") {
        party = 1
    }
    if (kind == "special") {
        if (stockBattleUi.pendingEntry != null) {
            if (stockBattleUi.pendingEntry.data.fp < 0) {
                party = 1
                canHeal = 1
            }
        }
    }
    size = battle.partySize(party)
    for (index = 0; index < size; index = index + 1) {
        fighter = battle.fighter(party, index)
        if (fighter != null) {
            if (kind == "item" || canHeal != 0 || fighter.hp > 0) {
                stockBattleUi.targets[stockBattleUi.targetCount] = index
                stockBattleUi.targetLabels[stockBattleUi.targetCount] = stockBattleUi.targetLabel(party, index, 8)
                stockBattleUi.targetFullLabels[stockBattleUi.targetCount] = stockBattleUi.targetLabel(party, index, 0)
                stockBattleUi.targetCount = stockBattleUi.targetCount + 1
            }
        }
    }
    stockBattleUi.targetParty = party
    stockBattleUi.targetCursor = 0
    return stockBattleUi.targetCount
}

stockBattleUi.openTargets = (kind) => {
    if (stockBattleUi.collectTargets(kind) < 1) {
        stockBattleUi.cue("cant")
        return 0
    }
    stockBattleUi.pendingKind = kind
    stockBattleUi.mode = "target"
    stockBattleUi.cue("choose")
    return 1
}

stockBattleUi.openList = (kind) => {
    if (kind == "special") {
        if (stockBattleUi.specialCount < 1) {
            stockBattleUi.cue("cant")
            return 0
        }
        stockBattleUi.list = stockBattleUi.specials
        stockBattleUi.listCount = stockBattleUi.specialCount
    } else {
        if (stockBattleUi.itemcount < 1) {
            stockBattleUi.cue("cant")
            return 0
        }
        stockBattleUi.list = stockBattleUi.items
        stockBattleUi.listCount = stockBattleUi.itemcount
    }
    stockBattleUi.listKind = kind
    stockBattleUi.listCursor = 0
    stockBattleUi.listTop = 0
    stockBattleUi.mode = "list"
    stockBattleUi.cue("choose")
    return 1
}

// True when the stack the player chose (item file and handle) still has a unit. Checked before anything is applied, so a
// vanished stack refuses the use instead of changing a stat the consume request could not pay for.
stockBattleUi.stackHeld = (entry) => {
    local(inventory) = battleinventory()
    local(index)
    local(stack)
    for (index = 0; index < inventory.count; index = index + 1) {
        stack = inventory.items[index]
        if (lcase(stack.source) == lcase(entry.file)) {
            if (stack.handle == entry.handle) {
                return 1
            }
        }
    }
    return 0
}

// Perform the chosen action on the chosen target through the package's own action functions, then show the numbers.
stockBattleUi.perform = (fighter) => {
    local(target) = battle.fighter(stockBattleUi.targetParty, stockBattleUi.targets[stockBattleUi.targetCursor])
    local(before) = stockBattleUi.snapshot()
    local(kind) = stockBattleUi.pendingKind
    local(entry) = stockBattleUi.pendingEntry
    if (kind == "item") {
        if (stockBattleUi.stackHeld(entry) == 0) {
            stockBattleUi.cue("cant")
            stockBattleUi.acting = null
            stockBattleUi.actingStance = ""
            stockBattleUi.mode = "target"
            stockBattleUi.refresh()
            return 0
        }
    }
    stockBattleUi.cue("choose")
    stockBattleUi.acting = fighter.id
    stockBattleUi.mode = "act"
    if (kind == "fight") {
        stockBattleUi.actingStance = "fight"
        stockBattleUi.message = fighter.name + " attacks " + target.name
        stockBattleUi.refresh()
        stockBattle.attack(fighter, target)
    }
    if (kind == "special") {
        stockBattleUi.actingStance = "special move"
        stockBattleUi.message = fighter.name + " uses " + entry.label + " on " + target.name
        stockBattleUi.refresh()
        stockBattle.special(fighter, target, entry.file)
    }
    if (kind == "item") {
        stockBattleUi.actingStance = "rest"
        stockBattleUi.message = fighter.name + " uses " + entry.label + " on " + target.name
        stockBattleUi.refresh()
        stockBattle.item(fighter, target, entry.file, entry.handle)
    }
    stockBattleUi.settle(before, "")
    return 1
}

stockBattleUi.isConfirm = (key) => {
    if (key == "ENTER" || key == "SPACE" || key == "confirm") {
        return 1
    }
    return 0
}

// One key. Returns 1 when the player's turn is over. Up/Down (and Left/Right in targets) move one step; Enter or
// Space confirms; Esc goes back one level and does nothing at the top.
stockBattleUi.handleKey = (fighter, key) => {
    local(mode) = stockBattleUi.mode
    local(entry)
    local(step) = 0
    if (key == "UP" || key == "LEFT" || key == "up" || key == "left") {
        step = -1
    }
    if (key == "DOWN" || key == "RIGHT" || key == "down" || key == "right") {
        step = 1
    }
    if (mode == "command") {
        if (step != 0 && (key == "UP" || key == "DOWN" || key == "up" || key == "down")) {
            stockBattleUi.cursor = (stockBattleUi.cursor + step + 4) % 4
            stockBattleUi.cue("select")
            return 0
        }
        if (stockBattleUi.isConfirm(key) == 1) {
            if (stockBattleUi.cursor == 0) {
                stockBattleUi.openTargets("fight")
                return 0
            }
            if (stockBattleUi.cursor == 1) {
                stockBattleUi.openList("special")
                return 0
            }
            if (stockBattleUi.cursor == 2) {
                stockBattleUi.openList("item")
                return 0
            }
            if (stockBattle.canRun() == 0) {
        // Run is listed but blocked: the cancel sound, and the player keeps the turn and stays in the menu.
                stockBattleUi.cue("cant")
                return 0
            }
            stockBattleUi.cue("choose")
            stockBattle.run()
            return 1
        }
        return 0
    }
    if (mode == "list") {
        if (step != 0 && (key == "UP" || key == "DOWN" || key == "up" || key == "down")) {
            stockBattleUi.listCursor = (stockBattleUi.listCursor + step + stockBattleUi.listCount) % stockBattleUi.listCount
            stockBattleUi.listTop = stockBattleUi.listCursor - (stockBattleUi.listCursor % stockBattleUi.layout.listCapacity)
            stockBattleUi.cue("select")
            return 0
        }
        if (stockBattleUi.isConfirm(key) == 1) {
            entry = stockBattleUi.list[stockBattleUi.listCursor]
            if (stockBattleUi.listKind == "special") {
        // A special the player cannot afford is refused here: nothing is spent, and the player stays in the menu.
                if (entry.data.smp > fighter.smp) {
                    stockBattleUi.cue("cant")
                    return 0
                }
                stockBattleUi.pendingEntry = entry
                stockBattleUi.openTargets("special")
                return 0
            }
            stockBattleUi.pendingEntry = entry
            stockBattleUi.openTargets("item")
            return 0
        }
        if (key == "ESC" || key == "cancel") {
            stockBattleUi.mode = "command"
            stockBattleUi.cue("select")
        }
        return 0
    }
    if (mode == "target") {
        if (step != 0) {
            stockBattleUi.targetCursor = (stockBattleUi.targetCursor + step + stockBattleUi.targetCount) % stockBattleUi.targetCount
            stockBattleUi.cue("select")
            return 0
        }
        if (stockBattleUi.isConfirm(key) == 1) {
            return stockBattleUi.perform(fighter)
        }
        if (key == "ESC" || key == "cancel") {
            if (stockBattleUi.pendingKind == "fight") {
                stockBattleUi.mode = "command"
            } else {
                stockBattleUi.mode = "list"
            }
            stockBattleUi.cue("select")
        }
        return 0
    }
    return 0
}

stockBattleUi.playerTurn = (index) => {
    local(fighter) = battle.fighter(1, index)
    local(key)
    local(done) = 0
    if (fighter == null) {
        return 0
    }
  // The battle may have been ended from outside since this pass began: no menu is opened for it.
    if (stockBattle.noteRecordedOutcome() != 0) {
        return 0
    }
    clearbuffer()
    stockBattleUi.menuIndex = index
    stockBattleUi.message = ""
    stockBattleUi.prepareLists(fighter)
    stockBattleUi.cursor = 0
    stockBattleUi.mode = "command"
    while (done == 0) {
        stockBattleUi.refresh()
        threadsleep(getthreadid(), 1/60)
        key = get()
        if (key != "") {
            done = stockBattleUi.handleKey(fighter, key)
        }
    // An outcome recorded from outside unwinds the command, list and target menus; the battle loop then runs
    // its normal finish, which hands the screen back.
        if (done == 0 && stockBattle.noteRecordedOutcome() != 0) {
            done = 1
        }
    }
    stockBattleUi.mode = "idle"
    stockBattleUi.refresh()
    return 0
}

// An enemy's turn is the package's own AI. The screen shows the fighter's fight stance while it acts and the numbers
// of whatever changed afterwards.
stockBattleUi.enemyTurn = (index) => {
    local(fighter) = battle.fighter(0, index)
    local(before)
    local(result)
    if (fighter == null) {
        return stockBattleUi.baseTurn(0, index)
    }
    before = stockBattleUi.snapshot()
    stockBattleUi.acting = fighter.id
    stockBattleUi.actingStance = "fight"
    result = stockBattleUi.baseTurn(0, index)
    stockBattleUi.settle(before, fighter.name + " acts")
    return result
}

stockBattleUi.baseTurn = stockBattle.turn
stockBattle.turn = (party, index) => {
    if (stockBattleUi.on == 0) {
        return stockBattleUi.baseTurn(party, index)
    }
    if (party == 1) {
        return stockBattleUi.playerTurn(index)
    }
    return stockBattleUi.enemyTurn(index)
}

registerplugin({
    name: "stock_battle",
    commands: {
        battle: (next) => {
            return next()
        },
        fight: (skill, bkg, next) => {
            return next(skill, bkg)
        },
        ai: (level, next) => {
            local(fighter)
            local(data)
            next(level)
            if (level < 0 || level > 3) {
                return 0
            }
            fighter = stockBattle.resolveFighter(sourcehandle())
            if (fighter == null) {
                return 0
            }
            data = stockBattle.enemyData(fighter)
            if (data == null) {
                return 0
            }
            return stockBattle.performAi(fighter, level)
        }
    }
})
