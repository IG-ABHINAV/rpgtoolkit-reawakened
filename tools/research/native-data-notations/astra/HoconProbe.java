// Host-only experiment using the official Lightbend parser and origin metadata.
import com.typesafe.config.*;
import java.io.File;
public class HoconProbe {
    public static void main(String[] args) {
        Config config = ConfigFactory.parseFile(new File(args[0]).getAbsoluteFile()).resolve(
            ConfigResolveOptions.defaults().setUseSystemEnvironment(false));
        config.getInt("actor.hp"); // A typed consumer check, not a JSON Schema claim.
        System.err.println("hp origin=" + config.getValue("actor.hp").origin().description());
        System.err.println("name origin=" + config.getValue("actor.name").origin().description());
        System.out.println(config.root().render(ConfigRenderOptions.concise()));
    }
}
