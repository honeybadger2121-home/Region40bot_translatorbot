# Discord Bot Auto-Restart Script
# This script will automatically restart the bot if it crashes

Write-Host "🤖 Starting Discord Bot with Auto-Restart..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the bot permanently" -ForegroundColor Yellow

$restartCount = 0
$maxRestarts = 50  # Prevent infinite restart loops
$restartDelay = 5  # Seconds to wait before restart

while ($restartCount -lt $maxRestarts) {
    try {
        Write-Host "`n🚀 Starting bot (Attempt #$($restartCount + 1))..." -ForegroundColor Cyan
        
        # Start the bot process
        $process = Start-Process -FilePath "node" -ArgumentList "index.js" -PassThru -Wait -NoNewWindow
        
        # Check exit code
        if ($process.ExitCode -eq 0) {
            Write-Host "✅ Bot exited gracefully (exit code 0)" -ForegroundColor Green
            break
        } else {
            Write-Host "❌ Bot crashed with exit code: $($process.ExitCode)" -ForegroundColor Red
            $restartCount++
            
            if ($restartCount -lt $maxRestarts) {
                Write-Host "⏱️ Waiting $restartDelay seconds before restart..." -ForegroundColor Yellow
                Start-Sleep -Seconds $restartDelay
                Write-Host "🔄 Restarting bot..." -ForegroundColor Cyan
            } else {
                Write-Host "🛑 Maximum restart attempts reached. Please check the bot code." -ForegroundColor Red
                break
            }
        }
    }
    catch {
        Write-Host "💥 Error starting bot: $($_.Exception.Message)" -ForegroundColor Red
        $restartCount++
        
        if ($restartCount -lt $maxRestarts) {
            Write-Host "⏱️ Waiting $restartDelay seconds before retry..." -ForegroundColor Yellow
            Start-Sleep -Seconds $restartDelay
        }
    }
}

Write-Host "`n🏁 Bot auto-restart script finished." -ForegroundColor Magenta
Read-Host "Press Enter to exit"
