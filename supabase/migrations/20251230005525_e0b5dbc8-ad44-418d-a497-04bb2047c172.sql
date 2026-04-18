-- Enable realtime for campaigns and dispatches tables (individually)
ALTER PUBLICATION supabase_realtime ADD TABLE campanhas_disparo;
ALTER PUBLICATION supabase_realtime ADD TABLE envios_disparo;