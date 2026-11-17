package com.peeky.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    requestAudioAccess()
  }

  // The player reads the phone's shared storage directly, so ask for the audio/storage
  // permission up front — without it the library simply looks empty. On Android 13+ the
  // media notification also needs its own runtime permission.
  private fun requestAudioAccess() {
    val perms = mutableListOf(
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        Manifest.permission.READ_MEDIA_AUDIO
      else
        Manifest.permission.READ_EXTERNAL_STORAGE
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      perms.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    val missing = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isNotEmpty()) {
      requestPermissions(missing.toTypedArray(), 42)
    }
  }
}
