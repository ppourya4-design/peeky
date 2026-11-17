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
  // permission up front — without it the library simply looks empty.
  private fun requestAudioAccess() {
    val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
      Manifest.permission.READ_MEDIA_AUDIO
    else
      Manifest.permission.READ_EXTERNAL_STORAGE
    if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(perm), 42)
    }
  }
}
