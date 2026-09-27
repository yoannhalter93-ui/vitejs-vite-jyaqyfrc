/*
 * Remplace le LauncherActivity généré par Bubblewrap (copié par le workflow
 * android.yml après "bubblewrap update").
 *
 * Ajout : au premier lancement (Android 13+), l'appli demande elle-même
 * l'autorisation Android des notifications AVANT d'ouvrir le site. Sans ça,
 * c'est Chrome qui posait la question au nom du site, l'autorisation de
 * l'appli restait refusée, et Chrome remettait celle du site à zéro à
 * chaque ouverture (la bannière "Active les notifications" revenait
 * toujours). Une seule demande : si la personne refuse, on n'insiste pas.
 */
package fr.entrenous.app;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    private static final int NOTIF_REQUEST = 4242;
    private static final String PREFS = "entrenous";
    private static final String ASKED = "notif_permission_asked";

    private boolean needsNotificationPrompt() {
        if (Build.VERSION.SDK_INT < 33) return false;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return false;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return !prefs.getBoolean(ASKED, false);
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !needsNotificationPrompt();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean ask = needsNotificationPrompt();
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
        if (ask && savedInstanceState == null) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ASKED, true).apply();
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIF_REQUEST);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIF_REQUEST) launchTwa();
    }

    @Override
    protected Uri getLaunchingUrl() {
        return super.getLaunchingUrl();
    }
}
