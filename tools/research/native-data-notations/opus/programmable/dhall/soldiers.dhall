-- #1778 research (Opus), AUTHORED: placement type and defaults.
let Placement =
      { id : Text
      , actor : Text
      , at : List Integer
      , whilePresent : Optional { program : Text }
      , activation : { onKey : Bool }
      }

let default = { activation = { onKey = False } }

in  { Placement, default }
