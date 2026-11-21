package com.example.agent.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class UiConfigTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void missingProcessViewUsesAutomaticMode() throws Exception {
        UiConfig config = mapper.readValue("{}", UiConfig.class);
        assertEquals("auto", config.getDefaultProcessView());
        assertEquals("auto", mapper.readTree(mapper.writeValueAsString(config))
                .get("default_process_view").asText());
    }

    @Test
    void explicitLegacyProcessViewsSurviveRoundTrip() throws Exception {
        for (String mode : new String[] { "full", "result", "auto" }) {
            UiConfig config = mapper.readValue("{\"default_process_view\":\"" + mode + "\"}", UiConfig.class);
            UiConfig restored = mapper.readValue(mapper.writeValueAsString(config), UiConfig.class);
            assertEquals(mode, restored.getDefaultProcessView());
        }
    }
}
