using Microsoft.AspNetCore.Builder;

public class OrderDto
{
    public string OrderId { get; set; } = "";
}

public static class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var app = builder.Build();
        app.MapGet("/api/orders", () => new[] { new OrderDto { OrderId = "ord-1" } });
        app.MapPost("/api/orders", () => "created");
        app.Run();
    }
}
