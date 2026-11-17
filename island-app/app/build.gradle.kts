import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ir.poyzo.peekyisland"
    compileSdk = 34

    defaultConfig {
        applicationId = "ir.poyzo.peekyisland"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

dependencies {
    // Kept deliberately tiny: framework Views only, no Compose, no Material.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.dynamicanimation:dynamicanimation:1.0.0")
}
