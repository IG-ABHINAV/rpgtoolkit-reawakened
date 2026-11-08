# #1778 research (Opus), AUTHORED: same six castle3left placements as the CUE
# fixture, generated from a grid rule; template and contracts are imported.
#   nickel export castle3left.ncl --format json
let soldiers = import "soldiers.ncl" in
let columns = [
  { actor = "train-soldier1", x = 208, prg = "scripts/train sold1.prg" },
  { actor = "train-soldier2", x = 400, prg = "scripts/train sold2.prg" },
] in
{
  kind = "scene",
  id = "castle3left",
  size = { width = 19, height = 19, layers = 8 },
  placements
    | Array soldiers.Placement
    = std.array.flat_map
      (fun row =>
        std.array.map
          (fun col =>
            soldiers.template & {
              id = "%{col.actor}-%{std.to_string (row + 1)}",
              actor = col.actor,
              at = [col.x, 319 + 96 * row, 1],
              whilePresent = { program = col.prg },
            })
          columns)
      [0, 1, 2],
}
