package studio.noema.duel;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ArenaFullscreenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
