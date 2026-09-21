package io.github.c1oudreamw.lumatile

internal fun webViewMajor(versionName: String?): Int? =
    versionName?.substringBefore('.')?.toIntOrNull()
