-- #1778 research (Opus), AUTHORED: same six castle3left placements, generated.
-- Hermetic: no Prelude/remote import (a remote import would need network plus
-- a sha256 integrity check; see the report).
--   dhall-to-json --file castle3left.dhall
let S = ./soldiers.dhall

let Column = { actor : Text, x : Integer, prg : Text }

let columns =
      [ { actor = "train-soldier1", x = +208, prg = "scripts/train sold1.prg" }
      , { actor = "train-soldier2", x = +400, prg = "scripts/train sold2.prg" }
      ]

let make =
      \(row : Natural) ->
      \(c : Column) ->
          S.default
        //  { id = "${c.actor}-${Natural/show (row + 1)}"
            , actor = c.actor
            , at = [ c.x, Natural/toInteger (319 + 96 * row), +1 ]
            , whilePresent = Some { program = c.prg }
            }

let placements =
      List/fold
        Natural
        [ 0, 1, 2 ]
        (List S.Placement)
        ( \(row : Natural) ->
          \(acc : List S.Placement) ->
            List/fold
              Column
              columns
              (List S.Placement)
              (\(c : Column) -> \(rest : List S.Placement) -> [ make row c ] # rest)
              acc
        )
        ([] : List S.Placement)

in  { kind = "scene"
    , id = "castle3left"
    , size = { width = 19, height = 19, layers = 8 }
    , placements
    }
