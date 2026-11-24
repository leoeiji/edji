package dev.edji.spike

import android.Manifest
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

/**
 * Spike screen: setup status (microphone, default assistant), an in-app voice
 * test using the same capture path as the session, the task list and the log.
 */
class MainActivity : ComponentActivity() {

    private var micGranted by mutableStateOf(false)
    private var isAssistant by mutableStateOf(false)
    private var testing by mutableStateOf(false)
    private var testStatus by mutableStateOf("")
    private var capture: VoiceCapture? = null

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micGranted = granted
        SpikeLog.log("permissão de microfone: ${if (granted) "concedida" else "negada"}")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        TaskStore.init(this)
        setContent {
            EdjiTheme {
                SpikeScreen(
                    micGranted = micGranted,
                    isAssistant = isAssistant,
                    testing = testing,
                    testStatus = testStatus,
                    onAskMic = { askMic.launch(Manifest.permission.RECORD_AUDIO) },
                    onOpenAssistant = ::openAssistantSettings,
                    onTest = ::testVoice,
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        micGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        isAssistant = getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
    }

    override fun onDestroy() {
        capture?.destroy()
        capture = null
        super.onDestroy()
    }

    private fun openAssistantSettings() {
        try {
            startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
        }
    }

    /** Runs the same capture path as the side-button session, inside the app. */
    private fun testVoice() {
        if (!micGranted) {
            askMic.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        capture?.destroy()
        testing = true
        testStatus = "Ouvindo..."
        Haptics.listening(this)
        SpikeLog.log("teste no app iniciado")
        capture = VoiceCapture(this, object : VoiceCapture.Listener {
            override fun onReady() {
                testStatus = "Ouvindo... (${capture?.engine})"
            }

            override fun onPartial(text: String) {
                testStatus = "“$text”"
            }

            override fun onFinal(text: String) {
                testing = false
                val task = TaskText.clean(text)
                if (task.isEmpty()) {
                    testStatus = "Não entendi."
                } else {
                    TaskStore.add(task, "teste")
                    Haptics.saved(this@MainActivity)
                    testStatus = "Anotado: $task"
                }
            }

            override fun onError(code: Int, name: String) {
                testing = false
                testStatus = "Erro: $name"
            }
        }).also { it.start() }
    }
}

private val Pine = Color(0xFF073E2B)
private val Mint = Color(0xFF78FF9B)
private val Ink = Color(0xFF152019)
private val Paper = Color(0xFFF7F9F5)

@Composable
private fun EdjiTheme(content: @Composable () -> Unit) {
    val scheme = if (isSystemInDarkTheme()) {
        darkColorScheme(
            primary = Mint, onPrimary = Pine,
            background = Color(0xFF09130E), onBackground = Color(0xFFF0F8F0),
            surface = Color(0xFF12221A), onSurface = Color(0xFFF0F8F0),
            surfaceVariant = Color(0xFF1A3023), onSurfaceVariant = Color(0xFFAABCAE),
        )
    } else {
        lightColorScheme(
            primary = Pine, onPrimary = Color(0xFFE3FFEA),
            background = Paper, onBackground = Ink,
            surface = Color.White, onSurface = Ink,
            surfaceVariant = Color(0xFFEFF3ED), onSurfaceVariant = Color(0xFF5B6A60),
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

@Composable
private fun SpikeScreen(
    micGranted: Boolean,
    isAssistant: Boolean,
    testing: Boolean,
    testStatus: String,
    onAskMic: () -> Unit,
    onOpenAssistant: () -> Unit,
    onTest: () -> Unit,
) {
    val tasks by TaskStore.tasks.collectAsState()
    val log by SpikeLog.lines.collectAsState()

    Scaffold { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text("Edji.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Black)
                Text(
                    "Spike: botão lateral → voz → lista",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatusLine("Microfone", micGranted, "Permitir", onAskMic)
                        StatusLine("Assistente digital padrão", isAssistant, "Configurar", onOpenAssistant)
                        Text(
                            "No Galaxy: Configurações → Recursos avançados → Botão lateral → Pressionar e manter → Assistente digital.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(onClick = onTest, enabled = !testing) { Text("Testar voz aqui") }
                        if (testStatus.isNotEmpty()) Text(testStatus, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            item { Text("Tarefas", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }

            if (tasks.isEmpty()) {
                item {
                    Text(
                        "Nenhuma tarefa ainda. Segure o botão lateral e diga o que precisa fazer.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(tasks, key = { it.id }) { task -> TaskRow(task) }

            item { Text("Registro", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(log.asReversed()) { line ->
                Text(line, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun StatusLine(label: String, ok: Boolean, action: String, onAction: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(if (ok) "✓" else "•", fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(8.dp))
        Text(label, modifier = Modifier.weight(1f))
        if (!ok) OutlinedButton(onClick = onAction) { Text(action) }
    }
}

@Composable
private fun TaskRow(task: Task) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Checkbox(checked = task.done, onCheckedChange = { TaskStore.toggle(task.id) })
        Text(
            task.text,
            modifier = Modifier.weight(1f),
            textDecoration = if (task.done) TextDecoration.LineThrough else null,
            color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onBackground,
        )
        Text(
            task.source.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = { TaskStore.remove(task.id) }) { Text("Excluir") }
    }
}
