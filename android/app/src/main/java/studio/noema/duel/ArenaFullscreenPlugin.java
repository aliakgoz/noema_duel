package studio.noema.duel;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Immersive arena with sensor rotation; normal application orientation is restored on exit. */
@CapacitorPlugin(name = "ArenaFullscreen")
public class ArenaFullscreenPlugin extends Plugin {
    private boolean enabled = false;
    private int previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private int previousBarsBehavior;

    private WindowInsetsControllerCompat bars() {
        Window window = getActivity().getWindow();
        return WindowCompat.getInsetsController(window, window.getDecorView());
    }

    private void hideBars() {
        WindowInsetsControllerCompat controller = bars();
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean requested = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getBridge().executeOnMainThread(() -> {
            if (requested && !enabled) {
                previousOrientation = getActivity().getRequestedOrientation();
                previousBarsBehavior = bars().getSystemBarsBehavior();
                enabled = true;
                getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
                hideBars();
            } else if (!requested && enabled) {
                enabled = false;
                bars().setSystemBarsBehavior(previousBarsBehavior);
                bars().show(WindowInsetsCompat.Type.systemBars());
                getActivity().setRequestedOrientation(previousOrientation);
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (enabled) getBridge().executeOnMainThread(this::hideBars);
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        super.handleOnConfigurationChanged(configuration);
        if (enabled) getBridge().executeOnMainThread(this::hideBars);
    }
}
