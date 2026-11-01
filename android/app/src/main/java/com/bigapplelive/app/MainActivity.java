package com.bigapplelive.app;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Keep Google's verified TWA flow, including its security/browser-bar fallback.
 * A browser launch failure must not crash the app or strand it on a black screen.
 */
public class MainActivity extends LauncherActivity {
    static final String SITE = "https://big-apple-live.replit.app/";
    private static final String TAG = "BigAppleLauncher";
    private boolean browserFallbackUsed;

    @Override
    protected void onCreate(Bundle state) {
        try {
            super.onCreate(state);
        } catch (RuntimeException | LinkageError error) {
            openBrowserFallback(error);
        }
    }

    @Override
    protected void launchTwa() {
        try {
            super.launchTwa();
        } catch (RuntimeException | LinkageError error) {
            openBrowserFallback(error);
        }
    }

    @Override
    protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return (context, builder, providerPackage, completion) -> {
            try {
                TwaLauncher.CCT_FALLBACK_STRATEGY.launch(
                        context, builder, providerPackage, completion);
            } catch (RuntimeException | LinkageError error) {
                openBrowserFallback(error);
            }
        };
    }

    void openBrowserFallback(Throwable reason) {
        if (browserFallbackUsed || isFinishing()) return;
        browserFallbackUsed = true;
        Log.w(TAG, "Trusted browser launch failed; opening the published site normally.", reason);
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(SITE))
                .addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            if (browser.resolveActivity(getPackageManager()) == null) {
                showNoBrowserMessage();
                return;
            }
            startActivity(browser);
            finish();
        } catch (ActivityNotFoundException | SecurityException error) {
            Log.w(TAG, "No enabled browser can open the published site.", error);
            showNoBrowserMessage();
        }
    }

    private void showNoBrowserMessage() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("A browser is needed")
                .setMessage("Please install or enable Google Chrome or another web browser, "
                        + "then open Big Apple Live again.")
                .setPositiveButton("Close", (dialog, which) -> finish())
                .setOnCancelListener(dialog -> finish())
                .show();
    }
}
