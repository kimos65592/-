package com.ahmed.electricitysmart

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.graphics.Paint
import android.os.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.max
import kotlin.math.min

// ================================================================
// MODELS
// ================================================================

data class Reading(
    val meterId: String,
    val date: String,
    val meterValue: Double,
    val balance: Double?
)

data class TopUp(
    val meterId: String,
    val date: String,
    val amount: Double
)

data class Tariff(
    val name: String,
    val fromKwh: Double,
    val toKwh: Double,
    val price: Double,
    val serviceFee: Double
)

data class AppSettings(
    val lowBalance: Double = 50.0,
    val monthlyBudget: Double = 1000.0,
    val abnormalPercent: Double = 30.0,
    val reminderHour: Int = 20
)

data class Meter(
    val id: String,
    val name: String,
    val company: String,
    val screenNumber: String
)

// ================================================================
// DEFAULT TARIFF
// ملاحظة: هذه قيم افتراضية ويمكن تعديلها من الإعدادات.
// ================================================================

object TariffRepository {

    val defaultTariffs = listOf(

        Tariff(
            "الشريحة 1",
            0.0,
            50.0,
            0.68,
            1.0
        ),

        Tariff(
            "الشريحة 2",
            50.0,
            100.0,
            0.78,
            2.0
        ),

        Tariff(
            "الشريحة 3",
            100.0,
            200.0,
            0.95,
            6.0
        ),

        Tariff(
            "الشريحة 4",
            200.0,
            350.0,
            1.55,
            11.0
        ),

        Tariff(
            "الشريحة 5",
            350.0,
            650.0,
            1.95,
            15.0
        ),

        Tariff(
            "الشريحة 6",
            650.0,
            1000.0,
            2.10,
            25.0
        ),

        Tariff(
            "الشريحة 7",
            1000.0,
            Double.POSITIVE_INFINITY,
            2.58,
            40.0
        )
    )
}

// ================================================================
// STORAGE
// ================================================================

class LocalStore(private val context: Context) {

    private val prefs =
        context.getSharedPreferences(
            "electricity_smart_data",
            Context.MODE_PRIVATE
        )

    // -----------------------------
    // READINGS
    // -----------------------------

    fun getReadings(): MutableList<Reading> {

        val result = mutableListOf<Reading>()

        val json =
            JSONArray(
                prefs.getString(
                    "readings",
                    "[]"
                )
            )

        for (i in 0 until json.length()) {

            val o = json.getJSONObject(i)

            result += Reading(
                meterId = o.getString("meterId"),
                date = o.getString("date"),
                meterValue = o.getDouble("meterValue"),
                balance =
                    if (o.isNull("balance"))
                        null
                    else
                        o.getDouble("balance")
            )
        }

        return result
    }

    fun saveReadings(list: List<Reading>) {

        val json = JSONArray()

        list.forEach { r ->

            json.put(
                JSONObject().apply {

                    put("meterId", r.meterId)
                    put("date", r.date)
                    put("meterValue", r.meterValue)

                    if (r.balance == null)
                        put("balance", JSONObject.NULL)
                    else
                        put("balance", r.balance)
                }
            )
        }

        prefs.edit()
            .putString("readings", json.toString())
            .apply()
    }

    // -----------------------------
    // TOP UPS
    // -----------------------------

    fun getTopUps(): MutableList<TopUp> {

        val result = mutableListOf<TopUp>()

        val json =
            JSONArray(
                prefs.getString(
                    "topups",
                    "[]"
                )
            )

        for (i in 0 until json.length()) {

            val o = json.getJSONObject(i)

            result += TopUp(
                meterId = o.getString("meterId"),
                date = o.getString("date"),
                amount = o.getDouble("amount")
            )
        }

        return result
    }

    fun saveTopUps(list: List<TopUp>) {

        val json = JSONArray()

        list.forEach { t ->

            json.put(
                JSONObject().apply {

                    put("meterId", t.meterId)
                    put("date", t.date)
                    put("amount", t.amount)
                }
            )
        }

        prefs.edit()
            .putString("topups", json.toString())
            .apply()
    }

    // -----------------------------
    // METERS
    // -----------------------------

    fun getMeters(): MutableList<Meter> {

        val json =
            JSONArray(
                prefs.getString(
                    "meters",
                    "[]"
                )
            )

        val result = mutableListOf<Meter>()

        for (i in 0 until json.length()) {

            val o = json.getJSONObject(i)

            result += Meter(
                id = o.getString("id"),
                name = o.getString("name"),
                company = o.getString("company"),
                screenNumber = o.getString("screenNumber")
            )
        }

        if (result.isEmpty()) {

            result += Meter(
                id = "main",
                name = "العداد الرئيسي",
                company = "",
                screenNumber = "3"
            )

            saveMeters(result)
        }

        return result
    }

    fun saveMeters(list: List<Meter>) {

        val json = JSONArray()

        list.forEach { m ->

            json.put(
                JSONObject().apply {

                    put("id", m.id)
                    put("name", m.name)
                    put("company", m.company)
                    put("screenNumber", m.screenNumber)
                }
            )
        }

        prefs.edit()
            .putString("meters", json.toString())
            .apply()
    }

    // -----------------------------
    // SETTINGS
    // -----------------------------

    fun getSettings(): AppSettings {

        return AppSettings(

            lowBalance =
                prefs.getFloat(
                    "lowBalance",
                    50f
                ).toDouble(),

            monthlyBudget =
                prefs.getFloat(
                    "monthlyBudget",
                    1000f
                ).toDouble(),

            abnormalPercent =
                prefs.getFloat(
                    "abnormalPercent",
                    30f
                ).toDouble(),

            reminderHour =
                prefs.getInt(
                    "reminderHour",
                    20
                )
        )
    }

    fun saveSettings(settings: AppSettings) {

        prefs.edit()

            .putFloat(
                "lowBalance",
                settings.lowBalance.toFloat()
            )

            .putFloat(
                "monthlyBudget",
                settings.monthlyBudget.toFloat()
            )

            .putFloat(
                "abnormalPercent",
                settings.abnormalPercent.toFloat()
            )

            .putInt(
                "reminderHour",
                settings.reminderHour
            )

            .apply()
    }

    // -----------------------------
    // BACKUP
    // -----------------------------

    fun exportJson(): String {

        val root = JSONObject()

        root.put(
            "readings",
            JSONArray(
                prefs.getString("readings", "[]")
            )
        )

        root.put(
            "topups",
            JSONArray(
                prefs.getString("topups", "[]")
            )
        )

        root.put(
            "meters",
            JSONArray(
                prefs.getString("meters", "[]")
            )
        )

        return root.toString(2)
    }

    fun importJson(data: String) {

        val root = JSONObject(data)

        prefs.edit()

            .putString(
                "readings",
                root.optJSONArray("readings")?.toString() ?: "[]"
            )

            .putString(
                "topups",
                root.optJSONArray("topups")?.toString() ?: "[]"
            )

            .putString(
                "meters",
                root.optJSONArray("meters")?.toString() ?: "[]"
            )

            .apply()
    }
}

// ================================================================
// DATE
// ================================================================

fun today(): String {

    return SimpleDateFormat(
        "yyyy-MM-dd",
        Locale.US
    ).format(Date())
}

fun parseDate(date: String): Long {

    return try {

        SimpleDateFormat(
            "yyyy-MM-dd",
            Locale.US
        ).parse(date)?.time ?: 0L

    } catch (_: Exception) {

        0L
    }
}

// ================================================================
// CALCULATIONS
// ================================================================

fun consumptionBetween(
    older: Reading,
    newer: Reading
): Double {

    return max(
        0.0,
        newer.meterValue - older.meterValue
    )
}

fun daysBetween(
    older: Reading,
    newer: Reading
): Double {

    return max(
        1.0,
        (parseDate(newer.date) -
                parseDate(older.date))
                .toDouble() /
                86_400_000.0
    )
}

fun dailyAverage(
    readings: List<Reading>
): Double {

    if (readings.size < 2)
        return 0.0

    val sorted =
        readings.sortedBy {
            it.date
        }

    val start =
        sorted.first()

    val end =
        sorted.last()

    val used =
        max(
            0.0,
            end.meterValue -
                    start.meterValue
        )

    val days =
        max(
            1.0,
            (parseDate(end.date) -
                    parseDate(start.date))
                .toDouble() /
                86_400_000.0
        )

    return used / days
}

fun averageLastNDays(
    readings: List<Reading>,
    n: Int
): Double {

    if (readings.size < 2)
        return 0.0

    val sorted =
        readings.sortedBy {
            it.date
        }

    val selected =
        sorted.takeLast(
            min(
                sorted.size,
                n + 1
            )
        )

    return dailyAverage(selected)
}

fun costForKwh(
    usage: Double,
    tariffs: List<Tariff>
): Double {

    if (usage <= 0)
        return 0.0

    var total = 0.0

    for (tariff in tariffs) {

        val usedInBand =
            max(
                0.0,
                min(
                    usage,
                    tariff.toKwh
                ) - tariff.fromKwh
            )

        if (usedInBand > 0) {

            total +=
                usedInBand *
                        tariff.price
        }

        if (
            usage <=
            tariff.toKwh
        ) break
    }

    val activeTariff =
        tariffs.lastOrNull {
            usage >= it.fromKwh
        }

    if (activeTariff != null) {

        total +=
            activeTariff.serviceFee
    }

    return total
}

fun money(value: Double): String {

    return String.format(
        Locale.US,
        "%.2f جنيه",
        value
    )
}

fun kwh(value: Double): String {

    return String.format(
        Locale.US,
        "%.2f ك.و.س",
        value
    )
}

// ================================================================
// MAIN ACTIVITY
// ================================================================

class MainActivity : ComponentActivity() {

    private lateinit var store: LocalStore

    private val notificationPermission =
        registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) {}

    override fun onCreate(
        savedInstanceState: Bundle?
    ) {

        super.onCreate(
            savedInstanceState
        )

        store =
            LocalStore(this)

        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {

            notificationPermission.launch(
                Manifest.permission.POST_NOTIFICATIONS
            )
        }

        setContent {

            ElectricitySmartApp(
                store = store,
                context = this
            )
        }
    }
}

// ================================================================
// THEME
// ================================================================

@Composable
fun ElectricityTheme(
    content: @Composable () -> Unit
) {

    MaterialTheme(

        colorScheme =
            darkColorScheme(

                primary =
                    Color(0xFF4EA1FF),

                secondary =
                    Color(0xFF60D7A6),

                background =
                    Color(0xFF0B1119),

                surface =
                    Color(0xFF151D28),

                error =
                    Color(0xFFFF6B6B)
            ),

        content = content
    )
}

// ================================================================
// APP
// ================================================================

@Composable
fun ElectricitySmartApp(
    store: LocalStore,
    context: Context
) {

    var selectedTab by
            remember {
                mutableIntStateOf(0)
            }

    var refresh by
            remember {
                mutableIntStateOf(0)
            }

    key(refresh) {

        val meters =
            remember {
                store.getMeters()
            }

        var selectedMeterId by
                remember {
                    mutableStateOf(
                        meters.firstOrNull()?.id
                            ?: "main"
                    )
                }

        ElectricityTheme {

            Scaffold(

                topBar = {

                    TopAppBar(

                        title = {

                            Text(
                                "⚡ عداد الكهرباء الذكي",
                                fontWeight =
                                    FontWeight.Bold
                            )
                        }
                    )
                },

                bottomBar = {

                    NavigationBar {

                        NavigationBarItem(

                            selected =
                                selectedTab == 0,

                            onClick = {
                                selectedTab = 0
                            },

                            icon = {
                                Text("🏠")
                            },

                            label = {
                                Text("الرئيسية")
                            }
                        )

                        NavigationBarItem(

                            selected =
                                selectedTab == 1,

                            onClick = {
                                selectedTab = 1
                            },

                            icon = {
                                Text("📊")
                            },

                            label = {
                                Text("التحليل")
                            }
                        )

                        NavigationBarItem(

                            selected =
                                selectedTab == 2,

                            onClick = {
                                selectedTab = 2
                            },

                            icon = {
                                Text("💳")
                            },

                            label = {
                                Text("الشحن")
                            }
                        )

                        NavigationBarItem(

                            selected =
                                selectedTab == 3,

                            onClick = {
                                selectedTab = 3
                            },

                            icon = {
                                Text("⚙️")
                            },

                            label = {
                                Text("الإعدادات")
                            }
                        )
                    }
                }

            ) { padding ->

                when (selectedTab) {

                    0 -> DashboardScreen(
                        Modifier.padding(padding),
                        store,
                        selectedMeterId
                    )

                    1 -> AnalysisScreen(
                        Modifier.padding(padding),
                        store,
                        selectedMeterId
                    )

                    2 -> TopUpScreen(
                        Modifier.padding(padding),
                        store,
                        selectedMeterId
                    )

                    3 -> SettingsScreen(
                        Modifier.padding(padding),
                        store,
                        context
                    )
                }
            }
        }
    }
}

// ================================================================
// DASHBOARD
// ================================================================

@Composable
fun DashboardScreen(
    modifier: Modifier,
    store: LocalStore,
    meterId: String
) {

    var showReadingDialog
            by remember {
                mutableStateOf(false)
            }

    var readings =
        store.getReadings()
            .filter {
                it.meterId == meterId
            }
            .sortedBy {
                it.date
            }

    var refresh by
            remember {
                mutableIntStateOf(0)
            }

    key(refresh) {

        readings =
            store.getReadings()
                .filter {
                    it.meterId == meterId
                }
                .sortedBy {
                    it.date
                }

        val average =
            dailyAverage(readings)

        val monthlyUsage =
            average * 30.0

        val estimatedCost =
            costForKwh(
             monthlyUsage,
                TariffRepository.defaultTariffs
            )

        val latestBalance =
            readings.lastOrNull()?.balance

        LazyColumn(

            modifier =
                modifier
                    .fillMaxSize()
                    .padding(16.dp),

            verticalArrangement =
                Arrangement.spacedBy(12.dp)
        ) {

            item {

                DashboardCard(

                    title = "💰 الرصيد الحالي",

                    value =
                        latestBalance?.let {
                            money(it)
                        } ?: "غير مسجل",

                    subtitle =
                        "آخر رصيد أدخلته"
                )
            }

            item {

                Row(

                    modifier =
                        Modifier.fillMaxWidth(),

                    horizontalArrangement =
                        Arrangement.spacedBy(10.dp)
                ) {

                    SmallMetric(
                        "⚡ يوميًا",
                        if (average > 0)
                            kwh(average)
                        else
                            "—",
                        Modifier.weight(1f)
                    )

                    SmallMetric(
                        "📅 30 يوم",
                        if (monthlyUsage > 0)
                            kwh(monthlyUsage)
                        else
                            "—",
                        Modifier.weight(1f)
                    )
                }
            }

            item {

                DashboardCard(

                    title =
                        "🔮 توقع الشهر",

                    value =
                        if (
                            monthlyUsage > 0
                        )
                            money(
                                estimatedCost
                            )
                        else
                            "—",

                    subtitle =
                        "تقدير مبني على القراءات المسجلة"
                )
            }

            item {

                if (readings.size >= 2) {

                    val last =
                        readings.last()

                    val previous =
                        readings[
                            readings.lastIndex - 1
                        ]

                    val used =
                        consumptionBetween(
                            previous,
                            last
                        )

                    val days =
                        daysBetween(
                            previous,
                            last
                        )

                    val avg =
                        used / days

                    DashboardCard(

                        title =
                            "📌 آخر فترة",

                        value =
                            kwh(used),

                        subtitle =
                            "من ${previous.date} إلى ${last.date} — متوسط ${kwh(avg)}/يوم"
                    )
                }
            }

            item {

                Button(

                    onClick = {
                        showReadingDialog = true
                    },

                    modifier =
                        Modifier.fillMaxWidth()
                ) {

                    Text(
                        "➕ تسجيل قراءة جديدة"
                    )
                }
            }

            item {

                Text(
                    "عدد القراءات: ${readings.size}",
                    color =
                        MaterialTheme.colorScheme
                            .onSurfaceVariant
                )
            }
        }
    }

    if (showReadingDialog) {

        ReadingDialog(

            meterId = meterId,

            existingReadings =
                store.getReadings()
                    .filter {
                        it.meterId == meterId
                    },

            onDismiss = {
                showReadingDialog = false
            },

            onSave = { reading ->

                val all =
                    store.getReadings()

                val previous =
                    all
                        .filter {
                            it.meterId ==
                                    meterId
                        }
                        .maxByOrNull {
                            parseDate(it.date)
                        }

                if (
                    previous != null &&
                    reading.meterValue <
                    previous.meterValue
                ) {

                    return@ReadingDialog
                }

                all.removeAll {

                    it.meterId ==
                            reading.meterId &&
                            it.date ==
                            reading.date
                }

                all.add(reading)

                store.saveReadings(all)

                showReadingDialog = false

                refresh++
            }
        )
    }
}

// ================================================================
// ANALYSIS
// ================================================================

@Composable
fun AnalysisScreen(
    modifier: Modifier,
    store: LocalStore,
    meterId: String
) {

    val readings =
        store.getReadings()
            .filter {
                it.meterId == meterId
            }
            .sortedBy {
                it.date
            }

    val average7 =
        averageLastNDays(
            readings,
            7
        )

    val average30 =
        averageLastNDays(
            readings,
            30
        )

    val monthly =
        average30 * 30.0

    val cost =
        costForKwh(
            monthly,
            TariffRepository.defaultTariffs
        )

    LazyColumn(

        modifier =
            modifier
                .fillMaxSize()
                .padding(16.dp),

        verticalArrangement =
            Arrangement.spacedBy(12.dp)
    ) {

        item {

            Text(
                "📊 تحليل الاستهلاك",
                style =
                    MaterialTheme.typography
                        .headlineSmall,

                fontWeight =
                    FontWeight.Bold
            )
        }

        item {

            SmallMetric(
                "متوسط آخر 7 أيام",
                kwh(average7),
                Modifier.fillMaxWidth()
            )
        }

        item {

            SmallMetric(
                "متوسط آخر 30 يوم",
                kwh(average30),
                Modifier.fillMaxWidth()
            )
        }

        item {

            SmallMetric(
                "توقع 30 يوم",
                kwh(monthly),
                Modifier.fillMaxWidth()
            )
        }

        item {

            SmallMetric(
                "التكلفة التقديرية",
                money(cost),
                Modifier.fillMaxWidth()
            )
        }

        item {

            Text(
                "📈 الاستهلاك بين القراءات",
                fontWeight =
                    FontWeight.Bold
            )
        }

        item {

            ConsumptionChart(
                readings = readings,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(220.dp)
            )
        }

        item {

            Card {

                Column(
                    Modifier.padding(16.dp)
                ) {

                    Text(
                        "تفاصيل القراءات",
                        fontWeight =
                            FontWeight.Bold
                    )

                    Spacer(
                        Modifier.height(8.dp)
                    )

                    readings.forEachIndexed {
                            index,
                            reading ->

                        if (
                            index == 0
                        ) {

                            Text(
                                "${reading.date} — ${reading.meterValue}"
                            )

                        } else {

                            val prev =
                                readings[
                                    index - 1
                                ]

                            val used =
                                consumptionBetween(
                                    prev,
                                    reading
                                )

                            Text(
                                "${reading.date} — ${reading.meterValue} | +${"%.2f".format(used)} ك.و.س"
                            )
                        }

                        Spacer(
                            Modifier.height(4.dp)
                        )
                    }
                }
            }
        }
    }
}

// ================================================================
// CHART
// ================================================================

@Composable
fun ConsumptionChart(
    readings: List<Reading>,
    modifier: Modifier
) {

    val points =
        remember(readings) {

            readings
                .zipWithNext()
                .map { pair ->

                    consumptionBetween(
                        pair.first,
                        pair.second
                    )
                }
        }

    Card(modifier) {

        Canvas(
            Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {

            if (points.isEmpty())
                return@Canvas

            val maxValue =
                max(
                    1.0,
                    points.maxOrNull() ?: 1.0
                )

            val path =
                Path()

            points.forEachIndexed {
                    index,
                    value ->

                val x =
                    if (points.size == 1)
                        size.width / 2
                    else
                        index *
                                size.width /
                                (points.size - 1)

                val y =
                    size.height -
                            (
                                    value /
                                            maxValue
                                    ).toFloat() *
                            size.height

                if (index == 0)
                    path.moveTo(x, y)
                else
                    path.lineTo(x, y)

                drawCircle(
                    color =
                        Color(0xFF4EA1FF),

                    radius = 5f,

                    center =
                        Offset(
                            x,
                            y
                        )
                )
            }

            drawPath(
                path = path,
                color =
                    Color(0xFF4EA1FF),

                style =
                    androidx.compose.ui.graphics
                        .drawscope
                        .Stroke(
                            width = 5f
                        )
            )
        }
    }
}

// ================================================================
// TOP UP
// ================================================================

@Composable
fun TopUpScreen(
    modifier: Modifier,
    store: LocalStore,
    meterId: String
) {

    var showDialog
            by remember {
                mutableStateOf(false)
            }

    var refresh
            by remember {
                mutableIntStateOf(0)
            }

    key(refresh) {

        val topups =
            store.getTopUps()
                .filter {
                    it.meterId == meterId
                }
                .sortedByDescending {
                    it.date
                }

        val total =
            topups.sumOf {
                it.amount
            }

        LazyColumn(

            modifier =
                modifier
                    .fillMaxSize()
                    .padding(16.dp),

            verticalArrangement =
                Arrangement.spacedBy(12.dp)
        ) {

            item {

                DashboardCard(

                    title =
                        "💳 إجمالي الشحن",

                    value =
                        money(total),

                    subtitle =
                        "كل الشحنات المسجلة"
                )
            }

            item {

                Button(

                    onClick = {
                        showDialog = true
                    },

                    modifier =
                        Modifier.fillMaxWidth()
                ) {

                    Text(
                        "➕ تسجيل شحنة"
                    )
                }
            }

            items(topups) { topup ->

                Card {

                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(16.dp),

                        horizontalArrangement =
                            Arrangement.SpaceBetween
                    ) {

                        Text(
                            topup.date
                        )

                        Text(
                            money(
                                topup.amount
                            ),

                            fontWeight =
                                FontWeight.Bold
                        )
                    }
                }
            }
        }
    }

    if (showDialog) {

        TopUpDialog(

            onDismiss = {
                showDialog = false
            },

            onSave = { amount ->

                val all =
                    store.getTopUps()

                all.add(

                    TopUp(
                        meterId,
                        today(),
                        amount
                    )
                )

                store.saveTopUps(all)

                showDialog = false

                refresh++
            }
        )
    }
}

// ================================================================
// SETTINGS
// ================================================================

@Composable
fun SettingsScreen(
    modifier: Modifier,
    store: LocalStore,
    context: Context
) {

    var settings by
            remember {
                mutableStateOf(
                    store.getSettings()
                )
            }

    var showTariffs
            by remember {
                mutableStateOf(false)
            }

    var showMeters
            by remember {
                mutableStateOf(false)
            }

    LazyColumn(

        modifier =
            modifier
                .fillMaxSize()
                .padding(16.dp),

        verticalArrangement =
            Arrangement.spacedBy(12.dp)
    ) {

        item {

            Text(
                "⚙️ الإعدادات",
                style =
                    MaterialTheme.typography
                        .headlineSmall,

                fontWeight =
                    FontWeight.Bold
            )
        }

        item {

            SettingCard(
                title = "تنبيه الرصيد المنخفض",
                value =
                    "${settings.lowBalance} جنيه",

                onClick = {

                    settings =
                        settings.copy(
                            lowBalance =
                                settings.lowBalance +
                                        10
                        )

                    store.saveSettings(
                        settings
                    )
                }
            )
        }

        item {

            SettingCard(
                title = "الميزانية الشهرية",
                value =
                    money(
                        settings.monthlyBudget
                    ),

                onClick = {

                    settings =
                        settings.copy(
                            monthlyBudget =
                                settings.monthlyBudget +
                                        100
                        )

                    store.saveSettings(
                        settings
                    )
                }
            )
        }

        item {

            Button(

                onClick = {
                    showTariffs = true
                },

                modifier =
                    Modifier.fillMaxWidth()
            ) {

                Text(
                    "🧮 إدارة التعريفة"
                )
            }
        }

        item {

            Button(

                onClick = {
                    showMeters = true
                },

                modifier =
                    Modifier.fillMaxWidth()
            ) {

                Text(
                    "⚡ إدارة العدادات"
                )
            }
        }

        item {

            Button(

                onClick = {

                    exportBackup(
                        context,
                        store.exportJson()
                    )

                },

                modifier =
                    Modifier.fillMaxWidth()
            ) {

                Text(
                    "💾 تصدير نسخة احتياطية"
                )
            }
        }

        item {

            Text(
                "التطبيق يعمل بدون إنترنت. البيانات محفوظة محليًا على الهاتف.",
                color =
                    MaterialTheme.colorScheme
                        .onSurfaceVariant
            )
        }
    }

    if (showTariffs) {

        TariffDialog(
            onDismiss = {
                showTariffs = false
            }
        )
    }

    if (showMeters) {

        MeterDialog(
            store = store,
            onDismiss = {
                showMeters = false
            }
        )
    }
}

// ================================================================
// COMPONENTS
// ================================================================

@Composable
fun DashboardCard(
    title: String,
    value: String,
    subtitle: String
) {

    Card(
        shape =
            RoundedCornerShape(
                18.dp
            )
    ) {

        Column(
            Modifier.padding(18.dp)
        ) {

            Text(
                title,
                color =
                    MaterialTheme.colorScheme
                        .onSurfaceVariant
            )

            Spacer(
                Modifier.height(5.dp)
            )

            Text(
                value,
                style =
                    MaterialTheme.typography
                        .headlineMedium,

                fontWeight =
                    FontWeight.Bold
            )

            Spacer(
                Modifier.height(4.dp)
            )

            Text(
                subtitle
            )
        }
    }
}

@Composable
fun SmallMetric(
    title: String,
    value: String,
    modifier: Modifier
) {

    Card(modifier) {

        Column(
            Modifier.padding(15.dp)
        ) {

            Text(
                title,
                color =
                    MaterialTheme.colorScheme
                        .onSurfaceVariant
            )

            Spacer(
                Modifier.height(4.dp)
            )

            Text(
                value,
                fontWeight =
                    FontWeight.Bold
            )
        }
    }
}

@Composable
fun SettingCard(
    title: String,
    value: String,
    onClick: () -> Unit
) {

    Card(

        Modifier.clickable(
            onClick = onClick
        )
    ) {

        Row(
            Modifier
                .fillMaxWidth()
                .padding(16.dp),

            horizontalArrangement =
                Arrangement.SpaceBetween
        ) {

            Text(title)

            Text(
                value,
                fontWeight =
                    FontWeight.Bold
            )
        }
    }
}

// ================================================================
// READING DIALOG
// ================================================================

@Composable
fun ReadingDialog(
    meterId: String,
    existingReadings: List<Reading>,
    onDismiss: () -> Unit,
    onSave: (Reading) -> Unit
) {

    var date by
            remember {
                mutableStateOf(
                    today()
                )
            }

    var value by
            remember {
                mutableStateOf("")
            }

    var balance by
            remember {
                mutableStateOf("")
            }

    var error by
            remember {
                mutableStateOf("")
            }

    val last =
        existingReadings
            .maxByOrNull {
                parseDate(it.date)
            }

    AlertDialog(

        onDismissRequest =
            onDismiss,

        title = {
            Text(
                "⚡ تسجيل قراءة"
            )
        },

        text = {

            Column {

                Text(
                    "الشاشة المستخدمة: 3"
                )

                Spacer(
                    Modifier.height(8.dp)
                )

                OutlinedTextField(
                    value = date,
                    onValueChange = {
                        date = it
                    },
                    label = {
                        Text(
                            "التاريخ"
                        )
                    }
                )

                Spacer(
                    Modifier.height(8.dp)
                )

                OutlinedTextField(
                    value = value,
                    onValueChange = {
                        value = it
                    },
                    label = {
                        Text(
                            "قراءة العداد ك.و.س"
                        )
                    }
                )

                Spacer(
                    Modifier.height(8.dp)
                )

                OutlinedTextField(
                    value = balance,
                    onValueChange = {
                        balance = it
                    },
                    label = {
                        Text(
                            "الرصيد بالجنيه — اختياري"
                        )
                    }
                )

                if (last != null) {

                    Spacer(
                        Modifier.height(8.dp)
                    )

                    Text(
                        "آخر قراءة: ${last.meterValue}",
                        color =
                            MaterialTheme.colorScheme
                                .secondary
                    )
                }

                if (error.isNotEmpty()) {

                    Text(
                        error,
                        color =
                            MaterialTheme.colorScheme
                                .error
                    )
                }
            }
        },

        confirmButton = {

            Button(

                onClick = {

                    val meter =
                        value.toDoubleOrNull()

                    if (meter == null) {

                        error =
                            "اكتب قراءة صحيحة"

                        return@Button
                    }

                    if (
                        last != null &&
                        meter <
                        last.meterValue
                    ) {

                        error =
                            "القراءة الجديدة أقل من القديمة"

                        return@Button
                    }

                    onSave(

                        Reading(

                            meterId,
                            date,
                            meter,
                            balance.toDoubleOrNull()
                        )
                    )
                }
            ) {

                Text("حفظ")
            }
        },

        dismissButton = {

            TextButton(
                onClick = onDismiss
            ) {

                Text("إلغاء")
            }
        }
    )
}

// ================================================================
// TOPUP DIALOG
// ================================================================

@Composable
fun TopUpDialog(
    onDismiss: () -> Unit,
    onSave: (Double) -> Unit
) {

    var amount by
            remember {
                mutableStateOf("")
            }

    AlertDialog(

        onDismissRequest =
            onDismiss,

        title = {
            Text(
                "💳 تسجيل شحنة"
            )
        },

        text = {

            OutlinedTextField(

                value = amount,

                onValueChange = {
                    amount = it
                },

                label = {
                    Text(
                        "قيمة الشحنة بالجنيه"
                    )
                }
            )
        },

        confirmButton = {

            Button(

                onClick = {

                    val value =
                        amount.toDoubleOrNull()

                    if (
                        value != null &&
                        value > 0
                    ) {

                        onSave(value)
                    }
                }
            ) {

                Text("حفظ")
            }
        },

        dismissButton = {

            TextButton(
                onClick = onDismiss
            ) {

                Text("إلغاء")
            }
        }
    )
}

// ================================================================
// TARIFF DIALOG
// ================================================================

@Composable
fun TariffDialog(
    onDismiss: () -> Unit
) {

    AlertDialog(

        onDismissRequest =
            onDismiss,

        title = {
            Text(
                "🧮 التعريفة"
            )
        },

        text = {

            LazyColumn {

                items(
                    TariffRepository
                        .defaultTariffs
                ) { tariff ->

                    Column(
                        Modifier.padding(
                            vertical = 5.dp
                        )
                    ) {

                        Text(
                            tariff.name,
                            fontWeight =
                                FontWeight.Bold
                        )

                        Text(
                            "من ${tariff.fromKwh} إلى ${tariff.toKwh} ك.و.س"
                        )

                        Text(
                            "${tariff.price} جنيه/ك.و.س"
                        )

                        Text(
                            "خدمة: ${tariff.serviceFee} جنيه"
                        )
                    }
                }
            }
        },

        confirmButton = {

            TextButton(
                onClick = onDismiss
            ) {

                Text("تم")
            }
        }
    )
}

// ================================================================
// METER DIALOG
// ================================================================

@Composable
fun MeterDialog(
    store: LocalStore,
    onDismiss: () -> Unit
) {

    var meters by
            remember {
                mutableStateOf(
                    store.getMeters()
                )
            }

    var name by
            remember {
                mutableStateOf("")
            }

    AlertDialog(

        onDismissRequest =
            onDismiss,

        title = {
            Text(
                "⚡ العدادات"
            )
        },

        text = {

            Column {

                meters.forEach {

                    Text(
                        "${it.name} — شاشة ${it.screenNumber}"
                    )
                }

                Spacer(
                    Modifier.height(10.dp)
                )

                OutlinedTextField(

                    value = name,

                    onValueChange = {
                        name = it
                    },

                    label = {
                        Text(
                            "اسم عداد جديد"
                        )
                    }
                )
            }
        },

        confirmButton = {

            Button(

                onClick = {

                    if (
                        name.isNotBlank()
                    ) {

                        meters =
                            meters.toMutableList()
                                .apply {

                                    add(

                                        Meter(
                                            id =
                                                UUID
                                                    .randomUUID()
                                                    .toString(),

                                            name =
                                                name,

                                            company =
                                                "",

                                            screenNumber =
                                                "3"
                                        )
                                    )
                                }

                        store.saveMeters(
                            meters
                        )

                        onDismiss()
                    }
                }
            ) {

                Text("إضافة")
            }
        },

        dismissButton = {

            TextButton(
                onClick = onDismiss
            ) {

                Text("إغلاق")
            }
        }
    )
}

// ================================================================
// BACKUP
// ================================================================

fun exportBackup(
    context: Context,
    data: String
) {

    val intent =
        Intent(
            Intent.ACTION_SEND
        ).apply {

            type =
                "application/json"

            putExtra(
                Intent.EXTRA_TEXT,
                data
            )
        }

    context.startActivity(
        Intent.createChooser(
            intent,
            "حفظ النسخة الاحتياطية"
        )
    )
}

// ================================================================
// NOTIFICATION UTILITY
// ================================================================

fun showLowBalanceNotification(
    context: Context,
    balance: Double
) {

    val channelId =
        "electricity_balance"

    val manager =
        context.getSystemService(
            Context.NOTIFICATION_SERVICE
        ) as NotificationManager

    if (
        Build.VERSION.SDK_INT >=
        Build.VERSION_CODES.O
    ) {

        val channel =
            NotificationChannel(

                channelId,

                "تنبيهات الكهرباء",

                NotificationManager
                    .IMPORTANCE_DEFAULT
            )

        manager.createNotificationChannel(
            channel
        )
    }

    val notification =
        NotificationCompat
            .Builder(
                context,
                channelId
            )

            .setSmallIcon(
                android.R.drawable
                    .stat_sys_warning
            )

            .setContentTitle(
                "⚡ رصيد الكهرباء منخفض"
            )

            .setContentText(
                "الرصيد الحالي ${money(balance)}"
            )

            .setAutoCancel(true)
            .build()

    manager.notify(
        1001,
        notification
    )
}
