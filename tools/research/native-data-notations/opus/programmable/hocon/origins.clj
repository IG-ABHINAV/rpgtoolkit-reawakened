;; #1778 research (Opus): drive the reference HOCON implementation (Lightbend
;; config, Java) from Clojure (no javac available) to print resolved JSON and
;; the ORIGIN (file:line) of selected values — the provenance an editor needs
;; to decide where a graphical edit must be written.
;;   java -cp config.jar:clojure.jar:spec.jar:core.specs.jar clojure.main origins.clj <file.conf>
(import '(com.typesafe.config ConfigFactory ConfigRenderOptions ConfigParseOptions ConfigResolveOptions))
(let [file (first *command-line-args*)
      conf (-> (ConfigFactory/parseFile (java.io.File. file) (ConfigParseOptions/defaults))
               (.resolve (ConfigResolveOptions/defaults)))
      root (.root conf)]
  (println "JSON" (.render (.withOnlyKey root "placements") (ConfigRenderOptions/concise)))
  (doseq [path ["placements"]]
    (let [lst (.getList conf path)]
      (doseq [i (range (.size lst))]
        (let [o (.get lst i)]
          (doseq [k ["id" "actor" "at" "whilePresent" "activation"]]
            (let [v (.get o k)]
              (println "ORIGIN" (str path "[" i "]." k) "=>" (.description (.origin v)))))))))
  (println "ENV-SUBSTITUTION" (try (.getString (.resolve (ConfigFactory/parseString "user = ${?USER}")) "user") (catch Exception e (str "error " (.getMessage e))))))
