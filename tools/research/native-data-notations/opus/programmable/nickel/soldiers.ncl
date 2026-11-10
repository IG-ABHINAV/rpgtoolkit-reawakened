# #1778 research (Opus), AUTHORED: contracts + mergeable defaults.
{
  Layer = std.contract.from_predicate (fun n => std.is_number n && n >= 1),
  Placement = {
    id | String,
    actor | String,
    at | Array Number,
    whilePresent | { program | String } | optional,
    activation | { onKey | Bool },
  },
  template = {
    activation = { onKey | default = false },
  },
}
