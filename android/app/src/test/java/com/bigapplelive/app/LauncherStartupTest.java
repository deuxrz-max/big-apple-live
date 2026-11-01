package com.bigapplelive.app;

import android.content.Intent;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import androidx.core.content.FileProvider;
import java.io.File;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class LauncherStartupTest {
    @Test
    public void splashImageCanBeSharedFromHelperFilesDirectory() {
        Context context = RuntimeEnvironment.getApplication();
        File splash = new File(context.getFilesDir(), "twa_splash/splash_image.png");
        Uri uri = FileProvider.getUriForFile(context,
                "com.bigapplelive.app.fileprovider", splash);
        assertEquals("content", uri.getScheme());
    }

    @Test
    public void launcherCanCreateWithoutBrowser() {
        Robolectric.buildActivity(MainActivity.class, launcherIntent())
                .create().start().resume().visible();
    }

    @Test(expected = IllegalArgumentException.class)
    public void providerDoesNotExposeUnrelatedPrivateFiles() {
        Context context = RuntimeEnvironment.getApplication();
        File privateFile = new File(context.getFilesDir(), "unrelated-private-file");
        FileProvider.getUriForFile(context, "com.bigapplelive.app.fileprovider", privateFile);
    }

    @Test
    public void missingBrowserShowsExplanationInsteadOfCrashing() {
        MainActivity activity = Robolectric.buildActivity(MainActivity.class, launcherIntent()).create().get();
        activity.openBrowserFallback(new ActivityNotFoundExceptionForTest());
        assertNotNull(ShadowAlertDialog.getLatestAlertDialog());
        assertTrue(ShadowAlertDialog.getLatestAlertDialog().isShowing());
    }

    @Test
    public void browserFallbackOpensPublishedSite() {
        // Exercise fallback independently, before the helper's browser discovery
        // can already trigger the one-shot fallback.
        MainActivity activity = Robolectric.buildActivity(MainActivity.class, launcherIntent()).get();
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(MainActivity.SITE))
                .addCategory(Intent.CATEGORY_BROWSABLE);
        ResolveInfo resolution = new ResolveInfo();
        resolution.activityInfo = new ActivityInfo();
        resolution.activityInfo.packageName = "test.browser";
        resolution.activityInfo.name = "test.browser.Browser";
        Shadows.shadowOf(activity.getPackageManager()).addResolveInfoForIntent(browser, resolution);
        activity.openBrowserFallback(new ActivityNotFoundExceptionForTest());
        Intent opened = Shadows.shadowOf(activity).getNextStartedActivity();
        assertNotNull(opened);
        assertEquals(MainActivity.SITE, opened.getDataString());
        assertTrue(activity.isFinishing());
    }

    private static final class ActivityNotFoundExceptionForTest extends RuntimeException { }

    private static Intent launcherIntent() {
        return new Intent(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }
}
